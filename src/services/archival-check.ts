import { Redis } from 'ioredis'
import { Configuration, Node, Pocket, PocketAAT, Session } from '@pokt-network/pocket-js'
import { hashBlockchainNodes, measuredPromise } from '../utils/helpers'
import { MetricsRecorder } from './metrics-recorder'
import { ArchivalCheck, NodeChecker, NodeCheckResponse } from './node-checker'
import { NodeCheckerWrapper } from './node-checker-wrapper'

const logger = require('../services/logger')

export type ArchivalCheckOptions = {
  path?: string
  body: string
  resultKey: string
  comparator: string | number
}

export class ArchivalChecker extends NodeCheckerWrapper {
  constructor(pocket: Pocket, redis: Redis, metricsRecorder: MetricsRecorder, origin: string) {
    super(pocket, redis, metricsRecorder, origin)
  }

  /**
   * Perfoms an archival check on all the nodes provided, this is nodes must confirm they're able to relay
   * archival request, failing to do so will result in the node getting slashed.
   * @param nodes nodes to perfom the check on.
   * @param archivalCheckOptions options containing the blockchain's archival configuration.
   * @param blockchainID Blockchain to request data from.
   * @param pocketAAT Pocket Authentication Token object.
   * @param pocketConfiguration pocket's configuration object.
   * @param pocketSession pocket's current session object.
   * @param applicationID application's database ID.
   * @param applicationPublicKey application's public key.
   * @param requestID request id.
   * @returns nodes that passed the chain check.
   */
  async check({
    nodes,
    archivalCheckOptions,
    blockchainID,
    pocketAAT,
    pocketConfiguration,
    pocketSession,
    applicationID,
    applicationPublicKey,
    requestID,
  }: ArchivalCheckParams): Promise<Node[]> {
    const { body, resultKey, comparator, path } = archivalCheckOptions

    // TODO: Add session nodes
    const sessionHash = await hashBlockchainNodes(blockchainID, [], this.redis)
    const archivalNodesKey = `archival-check-${sessionHash}`

    const archivalNodes: Node[] = await this.checkForCachedNodes(nodes, archivalNodesKey)
    const archivalNodesList: string[] = []

    if (archivalNodes.length > 0) {
      return archivalNodes
    }

    const nodeChecker = new NodeChecker(this.pocket, pocketConfiguration || this.pocket.configuration)

    const nodeArchivalChecks = await Promise.allSettled(
      nodes.map((node) =>
        measuredPromise(
          nodeChecker.performArchivalCheck(node, body, blockchainID, pocketAAT, resultKey, comparator, path, true)
        )
      )
    )

    // Sending unhandled failures as handled for metrics
    const nodeArchivalChecksData: NodeCheckResponse<ArchivalCheck>[] = nodeArchivalChecks.map((check, idx) => {
      if (check.status === 'fulfilled') {
        return check.value.value
      }

      return {
        node: nodes[idx],
        check: 'archival-check',
        success: false,
        response: check.reason,
      } as NodeCheckResponse<ArchivalCheck>
    })

    archivalNodes.push(
      ...(
        await this.filterNodes<ArchivalCheck>({
          nodes,
          blockchainID,
          pocketSession,
          requestID,
          elapsedTimes: nodeArchivalChecks.map((res) => (res.status === 'fulfilled' ? res.value.time : 0)),
          applicationID,
          applicationPublicKey,
          checkType: 'archival-check',
          checksResult: nodeArchivalChecksData,
        })
      ).map(({ node }) => node)
    )
    archivalNodesList.push(...archivalNodes.map(({ publicKey }) => publicKey))

    logger.log('info', 'ARCHIVAL CHECK COMPLETE: ' + archivalNodes.length + ' archival nodes', {
      requestID: requestID,
      blockchainID,
      origin: this.origin,
      sessionHash,
    })
    await this.redis.set(
      archivalNodesKey,
      JSON.stringify(archivalNodesList),
      'EX',
      archivalNodes.length > 0 ? 300 : 30 // will retry Chain check every 30 seconds if no nodes are archival
    )

    // If one or more nodes of this session are not archival, fire a consensus relay with the same check.
    // This will penalize the non archival nodes and cause them to get slashed for reporting incorrect data.
    if (archivalNodes.length < nodes.length) {
      await this.performChallenge(
        body,
        blockchainID,
        pocketAAT,
        pocketConfiguration,
        pocketSession,
        'ARCHIVAL CHECK CHALLENGE:',
        requestID,
        path
      )
    }

    return archivalNodes
  }
}

export type ArchivalCheckParams = {
  nodes: Node[]
  archivalCheckOptions: ArchivalCheckOptions
  blockchainID: string
  pocketAAT: PocketAAT
  pocketConfiguration: Configuration | undefined
  pocketSession: Session
  applicationID: string
  applicationPublicKey: string
  requestID: string
}
