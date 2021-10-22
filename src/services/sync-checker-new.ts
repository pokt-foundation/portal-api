import axios from 'axios'
import { Redis } from 'ioredis'
import { Configuration, Node, Pocket, PocketAAT } from '@pokt-network/pocket-js'
import { MetricsRecorder } from './metrics-recorder'
import { NodeChecker, SyncCheck } from './node-checker'
import { FilteredNode, NodeCheckerWrapper } from './node-checker-wrapper'
import { SyncCheckOptions } from './sync-checker'

const logger = require('../services/logger')

export class PocketSyncChecker extends NodeCheckerWrapper {
  defaultSyncAllowance: number

  constructor(
    pocket: Pocket,
    redis: Redis,
    metricsRecorder: MetricsRecorder,
    sessionKey: string,
    origin: string,
    defaultSyncAllowance = 0
  ) {
    super(pocket, redis, metricsRecorder, sessionKey, origin)
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

  private async getSyncFromAltruist(syncCheckOptions: SyncCheckOptions, blockchainSyncBackup: string): Promise<number> {
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
}
