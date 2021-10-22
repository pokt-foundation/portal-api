import { Redis } from 'ioredis'
import { Configuration, Node, Pocket, PocketAAT } from '@pokt-network/pocket-js'
import { MetricsRecorder } from './metrics-recorder'
import { ChainCheck, NodeChecker } from './node-checker'
import { NodeCheckerWrapper } from './node-checker-wrapper'

const logger = require('../services/logger')

export class PocketChainChecker extends NodeCheckerWrapper {
  constructor(pocket: Pocket, redis: Redis, metricsRecorder: MetricsRecorder, sessionKey: string, origin: string) {
    super(pocket, redis, metricsRecorder, sessionKey, origin)
  }

  /**
   * Perfoms a chain check on all the nodes provided, slashing nodes that fail the check and caching the response.
   * @param nodes nodes to perfom the check on.
   * @param data payload to be send to the blockchain.
   * @param chainID  blockchain chain's ID to evaluate against.
   * @param blockchainID Blockchain to request data from.
   * @param pocketAAT Pocket Authentication Token object.
   * @param pocketConfiguration pocket's configuration object.
   * @param applicationID application database's ID.
   * @param applicationPublicKey application's public key.
   * @param requestID request id.
   * @returns
   */
  async chainCheck(
    nodes: Node[],
    data: string,
    chainID: number,
    blockchainID: string,
    pocketAAT: PocketAAT,
    pocketConfiguration: Configuration | undefined,
    applicationID: string,
    applicationPublicKey: string,
    requestID: string
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
          blockchainID,
          requestID,
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
}
