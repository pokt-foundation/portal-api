import { Redis } from 'ioredis'
import { Pocket, Node, PocketAAT, Configuration } from '@pokt-network/pocket-js'
import { getNodeNetworkData, removeNodeFromSession } from '../utils/cache'
import { MAX_RELAYS_ERROR } from '../utils/constants'
import { MetricsRecorder } from './metrics-recorder'
import { ChainCheck, Check, NodeChecker, NodeCheckResponse, SyncCheck } from './node-checker'

const logger = require('../services/logger')

export type FilteredNode<T> = {
  node: Node
  data: NodeCheckResponse<T>
}
export class NodeCheckerWrapper {
  pocket: Pocket
  redis: Redis
  metricsRecorder: MetricsRecorder
  sessionKey: string
  origin: string

  constructor(pocket: Pocket, redis: Redis, metricsRecorder: MetricsRecorder, sessionKey: string, origin: string) {
    this.pocket = pocket
    this.redis = redis
    this.metricsRecorder = metricsRecorder
    this.sessionKey = sessionKey
    this.origin = origin
  }

  protected async cacheNodes(nodes: Node[], cacheKey: string): Promise<Node[]> {
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

  protected async filterNodes<T>(
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

  protected async performChallenge(
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
