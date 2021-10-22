import axios from 'axios'
import { Redis } from 'ioredis'
import { Pocket, Node, PocketAAT, Configuration } from '@pokt-network/pocket-js'
import { getNodeNetworkData, removeNodeFromSession } from '../utils/cache'
import { MAX_RELAYS_ERROR } from '../utils/constants'
import { MetricsRecorder } from './metrics-recorder'
import { ChainCheck, Check, NodeChecker, NodeCheckResponse, SyncCheck } from './node-checker'
import { SyncCheckOptions } from './sync-checker'

const logger = require('../services/logger')

type FilteredNode<T> = {
  node: Node
  data: NodeCheckResponse<T>
}
export class NodeCheckerWrapper {
  pocket: Pocket
  redis: Redis
  metricsRecorder: MetricsRecorder
  sessionKey: string
  origin: string
  defaultSyncAllowance: number

  constructor(
    pocket: Pocket,
    redis: Redis,
    metricsRecorder: MetricsRecorder,
    sessionKey: string,
    origin: string,
    defaultSyncAllowance = 0
  ) {
    this.pocket = pocket
    this.redis = redis
    this.metricsRecorder = metricsRecorder
    this.sessionKey = sessionKey
    this.origin = origin
    this.defaultSyncAllowance = defaultSyncAllowance
  }

  async syncCheck(
    nodes: Node[],
    requestID: string,
    syncCheckOptions: SyncCheckOptions,
    blockchainID: string,
    blockchainSyncBackup: string,
    applicationID: string,
    applicationPublicKey: string,
    pocket: Pocket,
    pocketAAT: PocketAAT,
    pocketConfiguration: Configuration
  ): Promise<Node[]> {
    const allowance = syncCheckOptions.allowance > 0 ? syncCheckOptions.allowance : this.defaultSyncAllowance

    const syncedNodesKey = `sync-check-${this.sessionKey}`

    const syncedRelayNodes: FilteredNode<SyncCheck>[] = []
    let syncedNodes: Node[] = await this.cacheNodes(nodes, syncedNodesKey)
    let syncedNodesList: string[] = []

    if (syncedNodes.length > 0) {
      return syncedNodes
    }

    const altruistBlockHeight = await this.getSyncFromAltruist(syncCheckOptions, blockchainSyncBackup)

    const nodeChecker = new NodeChecker(this.pocket, pocketConfiguration || this.pocket.configuration)

    const relayStart = process.hrtime()
    const nodeSyncChecks = await Promise.allSettled(
      nodes.map((node) =>
        nodeChecker.sync(
          node,
          syncCheckOptions.body,
          blockchainID,
          pocketAAT,
          syncCheckOptions.resultKey,
          syncCheckOptions.path,
          altruistBlockHeight,
          allowance
        )
      )
    )

    syncedRelayNodes.push(
      ...(
        await this.filterNodes<SyncCheck>(
          'sync-check',
          nodes,
          nodeSyncChecks,
          requestID,
          blockchainID,
          relayStart,
          applicationID,
          applicationPublicKey
        )
      ).sort((a, b) => a.data.result.blockHeight - b.data.result.blockHeight)
    )
    syncedNodes.push(...syncedRelayNodes.map(({ node }) => node))
    syncedNodesList.push(...syncedNodes.map((node) => node.publicKey))

    if (
      syncedRelayNodes.length >= 2 &&
      syncedRelayNodes[0].data.result.blockHeight > syncedRelayNodes[1].data.result.blockHeight + allowance
    ) {
      logger.log('error', 'SYNC CHECK ERROR: two highest nodes could not agree on sync', {
        requestID: requestID,
        blockchainID,
        origin: this.origin,
        sessionKey: this.sessionKey,
      })
    }

    const topBlockheight = syncedRelayNodes.length > 0 ? syncedRelayNodes[0].data.result.blockHeight : 0

    if (topBlockheight === 0) {
      logger.log(
        'error',
        'SYNC CHECK ERROR: top synced node result is invalid ' +
          JSON.stringify(
            syncedRelayNodes.map((node) => ({
              node: node.node,
              blockchainID,
              blockHeight: node.data.result.blockHeight,
            }))
          ),
        {
          requestID: requestID,
          relayType: '',
          blockchainID,
          typeID: '',
          serviceNode: '',
          error: '',
          elapsedTime: '',
          origin: this.origin,
          sessionKey: this.sessionKey,
        }
      )
    }

    // In case of altruist failure, compare nodes against the highest one recorded
    if (altruistBlockHeight === 0) {
      syncedRelayNodes.filter((node) => node.data.result.blockHeight < topBlockheight)
      syncedNodes = syncedRelayNodes.map(({ node }) => node)
      syncedNodesList = syncedNodes.map(({ publicKey }) => publicKey)
    }

    // Records all nodes out of sync, otherwise, remove failure mark
    await Promise.allSettled(
      nodeSyncChecks.map((nodeCheck, idx) => {
        const node = nodes[idx]

        if (syncedRelayNodes.some(({ node: { publicKey } }) => publicKey === node.publicKey)) {
          return this.redis.set(blockchainID + '-' + node.publicKey + '-failure', 'false', 'EX', 60 * 60 * 24 * 30)
        }
        return this.metricsRecorder.recordMetric({
          requestID: requestID,
          applicationID: applicationID,
          applicationPublicKey: applicationPublicKey,
          blockchainID,
          serviceNode: node.publicKey,
          relayStart,
          result: 500,
          bytes: Buffer.byteLength('OUT OF SYNC', 'utf8'),
          delivered: false,
          fallback: false,
          method: 'synccheck',
          error: `OUT OF SYNC: current block height on chain ${blockchainID}: ${topBlockheight} altruist block height: ${altruistBlockHeight} nodes height: ${
            nodeCheck.status === 'fulfilled' ? nodeCheck.value.result.blockHeight : 0
          } sync allowance: ${allowance}`,
          origin: this.origin,
          data: undefined,
          sessionKey: this.sessionKey,
        })
      })
    )

    logger.log('info', 'SYNC CHECK COMPLETE: ' + syncedNodes.length + ' nodes in sync', {
      requestID: requestID,
      blockchainID,
      origin: this.origin,
      sessionKey: this.sessionKey,
    })

    await this.redis.set(
      syncedNodesKey,
      JSON.stringify(syncedNodesList),
      'EX',
      syncedNodes.length > 0 ? 600 : 30 // will retry Chain check every 30 seconds if no nodes are in Chain
    )

    // If one or more nodes of this session are not in sync, fire a consensus relay with the same check.
    // This will penalize the out-of-sync nodes and cause them to get slashed for reporting incorrect data.
    if (syncedNodes.length < nodes.length) {
      await this.performChallenge(
        syncCheckOptions.body,
        blockchainID,
        pocketAAT,
        pocketConfiguration,
        'CHAIN CHECK CHALLENGE:',
        requestID
      )
    }

    return syncedNodes
  }

  async chainCheck(
    nodes: Node[],
    requestID: string,
    data: string,
    pocketAAT: PocketAAT,
    chainID: number,
    blockchainID: string,
    applicationID: string,
    applicationPublicKey: string,
    pocketConfiguration?: Configuration
  ): Promise<Node[]> {
    const checkedNodesKey = `chain-check-${this.sessionKey}`

    const checkedNodes: Node[] = await this.cacheNodes(nodes, checkedNodesKey)
    const checkedNodesList: string[] = []

    if (checkedNodes.length > 0) {
      return checkedNodes
    }

    const nodeChecker = new NodeChecker(this.pocket, pocketConfiguration || this.pocket.configuration)

    const relayStart = process.hrtime()
    const nodeChainChecks = await Promise.allSettled(
      nodes.map((node) => nodeChecker.chain(node, data, blockchainID, pocketAAT, chainID))
    )

    checkedNodes.push(
      ...(
        await this.filterNodes<ChainCheck>(
          'chain-check',
          nodes,
          nodeChainChecks,
          requestID,
          blockchainID,
          relayStart,
          applicationID,
          applicationPublicKey
        )
      ).map(({ node }) => node)
    )
    checkedNodesList.push(...checkedNodes.map(({ publicKey }) => publicKey))

    logger.log('info', 'CHAIN CHECK COMPLETE: ' + checkedNodes.length + ' nodes on chain', {
      requestID: requestID,
      blockchainID,
      origin: this.origin,
      sessionKey: this.sessionKey,
    })
    await this.redis.set(
      checkedNodesKey,
      JSON.stringify(checkedNodesList),
      'EX',
      checkedNodes.length > 0 ? 600 : 30 // will retry Chain check every 30 seconds if no nodes are in Chain
    )

    // If one or more nodes of this sessionKey are not in Chain, fire a consensus relay with the same check.
    // This will penalize the out-of-Chain nodes and cause them to get slashed for reporting incorrect data.
    if (checkedNodes.length < nodes.length) {
      await this.performChallenge(
        data,
        blockchainID,
        pocketAAT,
        pocketConfiguration,
        'CHAIN CHECK CHALLENGE:',
        requestID
      )
    }

    return checkedNodes
  }

  private async cacheNodes(nodes: Node[], cacheKey: string): Promise<Node[]> {
    const checkedNodes: Node[] = []
    let checkedNodesList: string[] = []

    const CheckedNodesCached = await this.redis.get(cacheKey)

    if (CheckedNodesCached) {
      checkedNodesList = JSON.parse(CheckedNodesCached)
      for (const node of nodes) {
        if (checkedNodesList.includes(node.publicKey)) {
          checkedNodes.push(node)
        }
      }
      return checkedNodes
    }

    // Cache is stale, start a new cache fill
    // First check cache lock key; if lock key exists, return full node set
    const chainLock = await this.redis.get('lock-' + cacheKey)

    if (chainLock) {
      return nodes
    } else {
      // Set lock as this thread checks the Chain with 60 second ttl.
      // If any major errors happen below, it will retry the Chain check every 60 seconds.
      await this.redis.set('lock-' + cacheKey, 'true', 'EX', 60)
    }

    return checkedNodes
  }

  async getSyncFromAltruist(syncCheckOptions: SyncCheckOptions, blockchainSyncBackup: string): Promise<number> {
    // Remove user/pass from the altruist URL
    const redactedAltruistURL = blockchainSyncBackup.replace(/[\w]*:\/\/[^\/]*@/g, '')
    const syncCheckPath = syncCheckOptions.path ? syncCheckOptions.path : ''

    try {
      const syncResponse = await axios({
        method: 'POST',
        url: `${blockchainSyncBackup}${syncCheckPath}`,
        data: syncCheckOptions.body,
        headers: { 'Content-Type': 'application/json' },
      })

      if (!(syncResponse instanceof Error)) {
        const payload = syncResponse.data // object that includes 'resultKey'
        const blockHeight = NodeChecker.parseBlockFromPayload(payload, syncCheckOptions.resultKey)

        return blockHeight
      }
      return 0
    } catch (e) {
      logger.log('error', e.message, {
        requestID: '',
        relayType: 'FALLBACK',
        typeID: '',
        serviceNode: 'fallback:' + redactedAltruistURL,
        error: '',
        elapsedTime: '',
        origin: this.origin,
      })
    }
    return 0
  }

  private async filterNodes<T>(
    checkType: Check,
    nodes: Node[],
    nodesPromise: PromiseSettledResult<NodeCheckResponse<unknown>>[],
    requestID: string,
    blockchainID: string,
    relayStart: [number, number],
    applicationID: string,
    applicationPublicKey: string
  ): Promise<FilteredNode<T>[]> {
    const filteredNodes: FilteredNode<T>[] = []

    for (const [idx, nodeCheckPromise] of nodesPromise.entries()) {
      const node = nodes[idx]
      const { serviceURL, serviceDomain } = await getNodeNetworkData(this.redis, node.publicKey, requestID)

      // helps debugging
      const formattedType = checkType.replace('-', ' ').toUpperCase()

      const rejected = nodeCheckPromise.status === 'rejected'
      const failed = rejected || nodeCheckPromise.value.response instanceof Error

      // Error
      if (failed) {
        let error: string | Error
        let errorMsg: string

        if (rejected) {
          error = errorMsg = nodeCheckPromise.reason
        } else {
          error = nodeCheckPromise.value.response as Error
          errorMsg = error.message
        }

        logger.log('error', `${formattedType} ERROR: ${JSON.stringify(error)}`, {
          requestID: requestID,
          serviceNode: node.publicKey,
          blockchainID,
          origin: this.origin,
          serviceURL,
          serviceDomain,
          sessionKey: this.sessionKey,
        })

        if (errorMsg === MAX_RELAYS_ERROR) {
          await removeNodeFromSession(this.redis, this.sessionKey, node.publicKey)
        }

        if (typeof error === 'object') {
          errorMsg = JSON.stringify(error)
        }

        const metricLog = {
          requestID: requestID,
          applicationID: applicationID,
          applicationPublicKey: applicationPublicKey,
          blockchainID,
          serviceNode: node.publicKey,
          relayStart,
          result: 500,
          delivered: false,
          fallback: false,
          method: checkType,
          error: errorMsg,
          origin: this.origin,
          data: undefined,
          sessionKey: this.sessionKey,
          bytes: 0,
        }

        switch (checkType) {
          case 'chain-check':
            metricLog.bytes = Buffer.byteLength('WRONG CHAIN', 'utf8')
            break
          case 'sync-check':
            metricLog.bytes = Buffer.byteLength(errorMsg || 'SYNC-CHECK', 'utf8')
            break
        }

        await this.metricsRecorder.recordMetric(metricLog)
        continue
      }

      // Success
      const {
        value: { result, success },
      } = nodeCheckPromise

      let resultMsg = ''
      let successMsg = ''

      switch (checkType) {
        case 'chain-check':
          {
            const { chainID } = result as ChainCheck

            resultMsg = `CHAIN CHECK RESULT: ${JSON.stringify({ node, chainID })}`
            successMsg = `CHAIN CHECK ${success ? 'SUCCESS' : 'FAILURE'}: ${node.publicKey} chainID: ${chainID}`
          }
          break
        case 'sync-check':
          {
            const { blockHeight } = result as SyncCheck

            resultMsg = `'SYNC CHECK RESULT: ${JSON.stringify({ node, blockchainID, blockHeight })}`
            successMsg = `SYNC CHECK ${success ? 'IN-SYNC' : 'BEHIND'}: ${node.publicKey} height: ${blockHeight}`
          }
          break
      }

      logger.log('info', resultMsg, {
        requestID: requestID,
        serviceNode: node.publicKey,
        blockchainID,
        origin: this.origin,
        serviceURL,
        serviceDomain,
        sessionKey: this.sessionKey,
      })

      logger.log('info', successMsg, {
        requestID: requestID,
        serviceNode: node.publicKey,
        blockchainID,
        origin: this.origin,
        serviceURL,
        serviceDomain,
        sessionKey: this.sessionKey,
      })

      if (!success) {
        continue
      }

      // Successful node: add to nodes list
      filteredNodes.push({ node, data: nodeCheckPromise.value as NodeCheckResponse<T> })
    }

    return filteredNodes
  }

  private async performChallenge(
    data: string,
    blockchainID: string,
    aat: PocketAAT,
    configuration: Configuration,
    log: string,
    requestID: string,
    path?: string
  ): Promise<void> {
    const nodeChecker = new NodeChecker(this.pocket, configuration || this.pocket.configuration)
    const consensusResponse = await nodeChecker.sendConsensusRelay(data, blockchainID, aat, path)

    logger.log('info', `${log} ${JSON.stringify(consensusResponse)}`, {
      requestID: requestID,
      relayType: '',
      typeID: '',
      serviceNode: '',
      error: '',
      elapsedTime: '',
      blockchainID,
      origin: this.origin,
      sessionKey: this.sessionKey,
    })
  }
}
