import { Redis } from 'ioredis'
import { Pocket, PocketAAT, Configuration, Node, Session } from '@pokt-network/pocket-js'
import { hashBlockchainNodes } from '../utils/helpers'
import { MetricsRecorder } from './metrics-recorder'
import { ArchivalCheck, NodeChecker } from './node-checker'
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

  async check(
    nodes: Node[],
    { body, resultKey, comparator, path }: ArchivalCheckOptions,
    blockchainID: string,
    pocketAAT: PocketAAT,
    pocketConfiguration: Configuration | undefined,
    pocketSession: Session,
    applicationID: string,
    applicationPublicKey: string,
    requestID: string
  ): Promise<Node[]> {
    const sessionHash = hashBlockchainNodes(blockchainID, pocketSession.sessionNodes)
    const archivalNodesKey = `archival-check-${sessionHash}`

    const archivalNodes: Node[] = await this.cacheNodes(nodes, archivalNodesKey)
    const archivalNodesList: string[] = []

    if (archivalNodes.length > 0) {
      return archivalNodes
    }

    const nodeChecker = new NodeChecker(this.pocket, pocketConfiguration || this.pocket.configuration)

    const relayStart = process.hrtime()
    const nodeArchivalChecks = await Promise.allSettled(
      nodes.map((node) => nodeChecker.archival(node, body, blockchainID, pocketAAT, resultKey, comparator, path, true))
    )

    archivalNodes.push(
      ...(
        await this.filterNodes<ArchivalCheck>(
          'archival-check',
          nodes,
          nodeArchivalChecks,
          blockchainID,
          pocketSession,
          requestID,
          relayStart,
          applicationID,
          applicationPublicKey
        )
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
