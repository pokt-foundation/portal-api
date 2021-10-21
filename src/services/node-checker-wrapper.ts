import { Redis } from 'ioredis'
import { Pocket, Session, Node, PocketAAT, Configuration, RelayResponse } from '@pokt-network/pocket-js'
import { getNodeNetworkData, removeNodeFromSession } from '../utils/cache'
import { MAX_RELAYS_ERROR } from '../utils/constants'
import { MetricsRecorder } from './metrics-recorder'
import { ChainCheck, NodeChecker, NodeCheckResponse } from './node-checker'

const logger = require('../services/logger')

export class NodeCheckerWrapper {
  pocket: Pocket
  redis: Redis
  metricsRecorder: MetricsRecorder
  sessionKey: string
  origin: string
  defaultAllowance: number

  constructor(
    pocket: Pocket,
    redis: Redis,
    metricsRecorder: MetricsRecorder,
    sessionKey: string,
    origin: string,
    defaultAllowance = 0
  ) {
    this.pocket = pocket
    this.redis = redis
    this.metricsRecorder = metricsRecorder
    this.sessionKey = sessionKey
    this.origin = origin
    this.defaultAllowance = defaultAllowance
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
    const checkedNodes: Node[] = []
    let checkedNodesList: string[] = []

    const checkedNodesKey = `chain-check-${this.sessionKey}`
    const CheckedNodesCached = await this.redis.get(checkedNodesKey)

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
    const chainLock = await this.redis.get('lock-' + checkedNodesKey)

    if (chainLock) {
      return nodes
    } else {
      // Set lock as this thread checks the Chain with 60 second ttl.
      // If any major errors happen below, it will retry the Chain check every 60 seconds.
      await this.redis.set('lock-' + checkedNodesKey, 'true', 'EX', 60)
    }
    const nodeChecker = new NodeChecker(this.pocket, pocketConfiguration || this.pocket.configuration)
    const relayStart = process.hrtime()
    const nodeChainChecks = await Promise.allSettled(
      nodes.map((node) => nodeChecker.chain(node, data, blockchainID, pocketAAT, chainID))
    )

    checkedNodes.push(
      ...(await this._chainCheck(
        nodes,
        nodeChainChecks,
        requestID,
        blockchainID,
        relayStart,
        applicationID,
        applicationPublicKey
      ))
    )
    checkedNodesList.push(...checkedNodes.map((node) => node.publicKey))

    logger.log('info', 'CHAIN CHECK COMPLETE: ' + checkedNodes.length + ' nodes on chain', {
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
  }

  private async _chainCheck(
    nodes: Node[],
    nodesChainsPromise: PromiseSettledResult<NodeCheckResponse<ChainCheck>>[],
    requestID: string,
    blockchainID: string,
    relayStart: [number, number],
    applicationID: string,
    applicationPublicKey: string
  ): Promise<Node[]> {
    const onChainNodes: Node[] = []

    for (const [idx, chainCheckPromise] of nodesChainsPromise.entries()) {
      const node = nodes[idx]
      const { serviceURL, serviceDomain } = await getNodeNetworkData(this.redis, node.publicKey, requestID)

      const rejected = chainCheckPromise.status === 'rejected'
      const failed = rejected || chainCheckPromise.value.response instanceof Error

      // Error
      if (failed) {
        let error: string | Error
        let errorMsg: string

        if (rejected) {
          error = errorMsg = chainCheckPromise.reason
        } else {
          error = chainCheckPromise.value.response as Error
          errorMsg = error.message
        }

        logger.log('error', 'CHAIN CHECK ERROR: ' + JSON.stringify(error), {
          requestID: requestID,
          relayType: '',
          typeID: '',
          serviceNode: node.publicKey,
          error: '',
          elapsedTime: '',
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

        await this.metricsRecorder.recordMetric({
          requestID: requestID,
          applicationID: applicationID,
          applicationPublicKey: applicationPublicKey,
          blockchainID,
          serviceNode: node.publicKey,
          relayStart,
          result: 500,
          bytes: Buffer.byteLength('WRONG CHAIN', 'utf8'),
          delivered: false,
          fallback: false,
          method: 'chaincheck',
          error: errorMsg,
          origin: this.origin,
          data: undefined,
          sessionKey: this.sessionKey,
        })

        continue
      }

      // Success
      const {
        value: {
          result: { chainID: nodeChainID },
          success,
        },
      } = chainCheckPromise

      logger.log('info', 'CHAIN CHECK RESULT: ' + JSON.stringify({ node, chainID: nodeChainID }), {
        requestID: requestID,
        relayType: '',
        typeID: '',
        serviceNode: node.publicKey,
        error: '',
        elapsedTime: '',
        blockchainID,
        origin: this.origin,
        serviceURL,
        serviceDomain,
        sessionKey: this.sessionKey,
      })

      const resultMessage = `CHAIN CHECK ${success ? 'SUCCESS' : 'FAILURE'}: ${node.publicKey} chainID: ${nodeChainID}`

      logger.log('info', resultMessage, {
        requestID: requestID,
        relayType: '',
        typeID: '',
        serviceNode: node.publicKey,
        error: '',
        elapsedTime: '',
        blockchainID,
        origin: this.origin,
        serviceURL,
        serviceDomain,
        sessionKey: this.sessionKey,
      })

      if (!success) {
        continue
      }

      // Correct chain: add to nodes list
      onChainNodes.push(node)
    }

    return onChainNodes
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
