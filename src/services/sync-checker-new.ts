import axios from 'axios'
import { Redis } from 'ioredis'
import { Configuration, Node, Pocket, PocketAAT, Session } from '@pokt-network/pocket-js'
import { getNodeNetworkData } from '../utils/cache'
import { hashBlockchainNodes } from '../utils/helpers'
import { MetricsRecorder } from './metrics-recorder'
import { NodeChecker, NodeCheckResponse, SyncCheck } from './node-checker'
import { NodeCheckerWrapper } from './node-checker-wrapper'
import { SyncCheckOptions } from './sync-checker'

const logger = require('../services/logger')

export class PocketSyncChecker extends NodeCheckerWrapper {
  defaultSyncAllowance: number

  constructor(pocket: Pocket, redis: Redis, metricsRecorder: MetricsRecorder, pocketSession: Session, origin: string) {
    super(pocket, redis, metricsRecorder, pocketSession, origin)
  }

  /**
   * Performs a sync check on all the nodes provided, slashing nodes that fail the check and caching the response. The
   * sync works by comparing the height among the highest node from the ones provided and also comparing against the
   * altruist height.
   * @param nodes nodes to perfom the check on.
   * @param syncCheckOptions options containing the blockchain's height configuration.
   * @param blockchainID Blockchain to request data from.
   * @param pocketAAT Pocket Authentication Token object.
   * @param pocketConfiguration pocket's configuration object.
   * @param altruistURL altruist's URL.
   * @param applicationID application database's ID.
   * @param applicationPublicKey application's public key.
   * @param requestID request id.
   * @returns nodes that passed the sync check.
   */
  async check(
    nodes: Node[],
    syncCheckOptions: SyncCheckOptions,
    blockchainID: string,
    pocketAAT: PocketAAT,
    pocketConfiguration: Configuration | undefined,
    altruistURL: string,
    applicationID: string,
    applicationPublicKey: string,
    requestID: string,
    defaultAllowance = 5
  ): Promise<Node[]> {
    const sessionHash = hashBlockchainNodes(blockchainID, this.pocketSession.sessionNodes)

    const allowance = syncCheckOptions.allowance > 0 ? syncCheckOptions.allowance : defaultAllowance

    const syncedNodesKey = `sync-check-${sessionHash}`

    const syncedRelayNodes: NodeCheckResponse<SyncCheck>[] = []
    let syncedNodes: Node[] = await this.cacheNodes(nodes, syncedNodesKey)
    let syncedNodesList: string[] = []

    if (syncedNodes.length > 0) {
      return syncedNodes
    }

    const altruistBlockHeight = await this.getSyncFromAltruist(syncCheckOptions, altruistURL)

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
          blockchainID,
          requestID,
          relayStart,
          applicationID,
          applicationPublicKey
        )
      ).sort((a, b) => b.output.blockHeight - a.output.blockHeight)
    )
    syncedNodes.push(...syncedRelayNodes.map(({ node }) => node))
    syncedNodesList.push(...syncedNodes.map((node) => node.publicKey))

    let errorState = false

    if (
      syncedRelayNodes.length >= 2 &&
      syncedRelayNodes[0].output.blockHeight > syncedRelayNodes[1].output.blockHeight + allowance
    ) {
      logger.log('error', 'SYNC CHECK ERROR: two highest nodes could not agree on sync', {
        requestID: requestID,
        blockchainID,
        origin: this.origin,
        sessionHash,
      })
      errorState = true
    }

    const topBlockheight = syncedRelayNodes.length > 0 ? syncedRelayNodes[0].output.blockHeight : 0

    if (topBlockheight === 0) {
      logger.log(
        'error',
        'SYNC CHECK ERROR: top synced node result is invalid ' +
          JSON.stringify(
            syncedRelayNodes.map((node) => ({
              node: node.node,
              blockchainID,
              blockHeight: node.output.blockHeight,
            }))
          ),
        {
          requestID: requestID,
          blockchainID,
          origin: this.origin,
          sessionHash: sessionHash,
        }
      )
      errorState = true
    }

    if (altruistBlockHeight === 0 || isNaN(altruistBlockHeight)) {
      // Failure to find sync from consensus and altruist
      logger.log('info', 'SYNC CHECK ALTRUIST FAILURE: ' + altruistBlockHeight, {
        requestID: requestID,
        blockchainID,
        serviceNode: 'ALTRUIST',
        origin: this.origin,
        sessionHash,
      })

      if (errorState) {
        return nodes
      }
    } else {
      logger.log('info', 'SYNC CHECK ALTRUIST CHECK: ' + altruistBlockHeight, {
        requestID: requestID,
        blockchainID,
        serviceNode: 'ALTRUIST',
        origin: this.origin,
        sessionHash,
      })
    }

    // Besides comparing against the altruist, also compare against the highest blockheight of the session.
    // This is specially useful in case of altruist failure, where nodes will return success as long as
    // they have a blockheight over 0.
    const syncSuccess = syncedRelayNodes.filter((node) => node.output.blockHeight + allowance >= topBlockheight)

    syncedNodes = syncSuccess.map(({ node }) => node)
    syncedNodesList = syncedNodes.map(({ publicKey }) => publicKey)

    // Records and log all nodes out of sync, otherwise, remove failure mark
    await Promise.allSettled(
      syncedRelayNodes.map(async (node) => {
        const syncedNode = syncSuccess.find(({ node: { publicKey } }) => publicKey === node.node.publicKey)
        const { serviceURL, serviceDomain } = await getNodeNetworkData(this.redis, node.node.publicKey, requestID)

        if (syncedNode) {
          logger.log(
            'info',
            `SYNC-CHECK IN-SYNC: ${syncedNode.node.publicKey} height: ${syncedNode.output.blockHeight}`,
            {
              requestID: requestID,
              serviceNode: syncedNode.node.publicKey,
              blockchainID,
              origin: this.origin,
              serviceURL,
              serviceDomain,
              sessionHash,
            }
          )

          return this.redis.set(
            blockchainID + '-' + syncedNode.node.publicKey + '-failure',
            'false',
            'EX',
            60 * 60 * 24 * 30
          )
        }

        logger.log('info', `SYNC-CHECK BEHIND: ${node.node.publicKey} height: ${node.output.blockHeight}`, {
          requestID: requestID,
          serviceNode: node.node.publicKey,
          blockchainID,
          origin: this.origin,
          serviceURL,
          serviceDomain,
          sessionHash,
        })

        return this.metricsRecorder.recordMetric({
          requestID: requestID,
          applicationID: applicationID,
          applicationPublicKey: applicationPublicKey,
          blockchainID,
          serviceNode: node.node.publicKey,
          relayStart,
          result: 500,
          bytes: Buffer.byteLength('OUT OF SYNC', 'utf8'),
          delivered: false,
          fallback: false,
          method: 'synccheck',
          error: `OUT OF SYNC: current block height on chain ${blockchainID}: ${topBlockheight} altruist block height: ${altruistBlockHeight} node height: ${node.output.blockHeight} sync allowance: ${allowance}`,
          origin: this.origin,
          data: undefined,
          pocketSession: this.pocketSession,
        })
      })
    )

    logger.log('info', 'SYNC CHECK COMPLETE: ' + syncedNodes.length + ' nodes in sync', {
      requestID: requestID,
      blockchainID,
      origin: this.origin,
      sessionHash,
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
        'SYNC CHECK CHALLENGE:',
        requestID
      )
    }

    return syncedNodes
  }

  /**
   * Obtains the blockheight from ann altruist node.
   * @param syncCheckOptions options containing the blockchain's height configuration.
   * @param altruistURL altruist's URL.
   * @returns altruist block height
   */
  private async getSyncFromAltruist(syncCheckOptions: SyncCheckOptions, altruistURL: string): Promise<number> {
    const redactedAltruistURL = altruistURL.replace(/[\w]*:\/\/[^\/]*@/g, '')
    const syncCheckPath = syncCheckOptions.path ? syncCheckOptions.path : ''

    try {
      const syncResponse = await axios({
        method: 'POST',
        url: `${altruistURL}${syncCheckPath}`,
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
        relayType: 'FALLBACK',
        serviceNode: 'fallback:' + redactedAltruistURL,
        origin: this.origin,
      })
    }
    return 0
  }
}
