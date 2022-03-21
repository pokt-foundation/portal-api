import { Redis } from 'ioredis'
import { Pocket, Node, PocketAAT, Configuration, Session } from '@pokt-network/pocket-js'
import { hashBlockchainNodes } from '../utils/helpers'
import { MetricsRecorder } from './metrics-recorder'
import { ArchivalCheck, ChainCheck, Check, NodeChecker, NodeCheckResponse, SyncCheck } from './node-checker'

const logger = require('../services/logger')

export class NodeCheckerWrapper {
  pocket: Pocket
  redis: Redis
  metricsRecorder: MetricsRecorder
  origin: string

  constructor(pocket: Pocket, redis: Redis, metricsRecorder: MetricsRecorder, origin: string) {
    this.pocket = pocket
    this.redis = redis
    this.metricsRecorder = metricsRecorder
    this.origin = origin
  }

  /**
   * Helper method to check for cached checks, is a check is already cached or in progress,
   * returns valid nodes from the cached result or session. Otherwise set a cache lock.
   * @param {Node[]} nodes session nodes.
   * @param cacheKey key to get/set results.
   * @returns nodes cached or provided on case of cache/lock.
   */
  protected async checkForCachedNodes(nodes: Node[], cacheKey: string): Promise<Node[]> {
    const checkedNodes: Node[] = []
    let checkedNodesList: string[] = []

    const checkedNodesCached = await this.redis.get(cacheKey)

    checkedNodesList = JSON.parse(checkedNodesCached)

    if (checkedNodesList && checkedNodesList.length > 0) {
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
      // If any major errors happen below, it will retry the check every 60 seconds.
      await this.redis.set('lock-' + cacheKey, 'true', 'EX', 60)
    }

    return checkedNodes
  }

  /**
   * Logs responses from the node checks and filters failing nodes.
   * @param checkType type of check made.
   * @param nodes nodes to be filtered.
   * @param checksResult results of a check on node's.
   * @param blockchainID blockchain used for the checks.
   * @param requestID request id.
   * @param relayStart time when the checks started.
   * @param applicationID application database's ID.
   * @param applicationPublicKey application's public key.
   * @returns nodes having successful and valid check results.
   */
  protected async filterNodes<T>({
    checkType,
    nodes,
    checksResult,
    blockchainID,
    pocketSession,
    requestID,
    applicationID,
    applicationPublicKey,
    elapsedTimes,
  }: FilterParams<T>): Promise<NodeCheckResponse<T>[]> {
    const filteredNodes: NodeCheckResponse<T>[] = []
    // TODO: Use session again
    const sessionHash = await hashBlockchainNodes(blockchainID, [], this.redis)

    for (const [idx, check] of checksResult.entries()) {
      const node = nodes[idx]

      // helps debugging
      const formattedType = checkType.replace('-', ' ').toUpperCase()

      const failed = check.response instanceof Error

      if (failed) {
        const error: string | Error = check.response as Error
        // Converting to stream will get string representation of most errors
        let errorMsg: string = error.message || (error as unknown as string)

        logger.log('error', `${formattedType} ERROR: ${error || errorMsg}`, {
          requestID: requestID,
          serviceNode: node.publicKey,
          blockchainID,
          origin: this.origin,
          serviceURL: '',
          serviceDomain: '',
          sessionHash,
        })

        // TODO: Fix
        // if (errorMsg === MAX_RELAYS_ERROR) {
        //   await removeNodeFromSession()
        // }

        if (typeof error === 'object') {
          errorMsg = JSON.stringify(error)
        }

        const metricLog = {
          requestID: requestID,
          applicationID: applicationID,
          applicationPublicKey: applicationPublicKey,
          blockchainID,
          serviceNode: node.publicKey,
          elapsedTime: elapsedTimes[idx],
          result: 500,
          delivered: false,
          fallback: false,
          method: checkType,
          error: typeof error === 'string' ? error : errorMsg,
          origin: this.origin,
          data: undefined,
          sessionHash,
          bytes: 0,
          // TODO: Change to v2 session object once is implemented
          session: undefined,
          code: undefined,
        }

        switch (checkType) {
          case 'chain-check':
            metricLog.bytes = Buffer.byteLength('WRONG CHAIN', 'utf8')
            break
          case 'archival-check':
            metricLog.bytes = Buffer.byteLength('NOT ARCHIVAL', 'utf8')
            break
          case 'sync-check':
            metricLog.bytes = Buffer.byteLength(errorMsg || 'SYNC-CHECK', 'utf8')
            break
        }

        this.metricsRecorder.recordMetric(metricLog).catch(function log(e) {
          logger.log('error', 'Error recording metrics: ' + e, {
            requestID: requestID,
            relayType: 'APP',
            typeID: applicationID,
            serviceNode: node.publicKey,
          })
        })
        continue
      }

      // Valid response
      const { output, success } = check

      let resultMsg = ''
      let successMsg = ''

      switch (checkType) {
        case 'chain-check':
          {
            const { chainID } = output as unknown as ChainCheck

            resultMsg = `CHAIN-CHECK RESULT: ${JSON.stringify({ node, chainID })}`
            successMsg = `CHAIN-CHECK ${success ? 'SUCCESS' : 'FAILURE'}: ${node.publicKey} chainID: ${chainID}`
          }
          break
        case 'archival-check': {
          const { message } = output as unknown as ArchivalCheck

          resultMsg = `ARCHIVAL-CHECK RESULT: ${JSON.stringify({ node, message })}`
          successMsg = `ARCHIVAL-CHECK ${success ? 'SUCCESS' : 'FAILURE'}: ${node.publicKey} result: ${message}`
          break
        }
        case 'sync-check':
          {
            const { blockHeight } = output as unknown as SyncCheck

            resultMsg = `SYNC-CHECK RESULT: ${JSON.stringify({ node, blockchainID, blockHeight })}`
          }
          break
      }

      logger.log('info', resultMsg, {
        requestID: requestID,
        serviceNode: node.publicKey,
        blockchainID,
        origin: this.origin,
        serviceURL: '',
        serviceDomain: '',
        sessionHash,
      })

      // Sync check requires additional assertions outside the scope of this method.
      if (checkType !== 'sync-check') {
        logger.log('info', successMsg, {
          requestID: requestID,
          serviceNode: node.publicKey,
          blockchainID,
          origin: this.origin,
          serviceURL: '',
          serviceDomain: '',
          sessionHash,
        })
      }

      if (!success) {
        continue
      }

      // Successful node: add to nodes list
      filteredNodes.push(check)
    }

    return filteredNodes
  }

  /**
   * Perfoms a challenge for nodes failing checks, doing a consensus relay so nodes
   * that fail such check gets punished by the network.
   * @param data payload to send to the blockchain.
   * @param blockchainID Blockchain to request data from.
   * @param aat Pocket Authentication token object.
   * @param configuration Pocket configuration object.
   * @param log  prefix message to be appended to the consensus result.
   * @param requestID request id.
   * @param path  optional. Blockchain's path to send the request to.
   */
  protected async performChallenge(
    data: string,
    blockchainID: string,
    aat: PocketAAT,
    configuration: Configuration,
    pocketSession: Session,
    log: string,
    requestID: string,
    path?: string
  ): Promise<void> {
    const nodeChecker = new NodeChecker(this.pocket, configuration || this.pocket.configuration)
    const consensusResponse = await nodeChecker.sendConsensusRelay(data, blockchainID, aat, path)

    logger.log('info', `${log} ${JSON.stringify(consensusResponse)}`, {
      requestID: requestID,
      blockchainID,
      origin: this.origin,
      // TODO: Add session nodes
      sessionHash: await hashBlockchainNodes(blockchainID, [], this.redis),
    })
  }
}

export type FilterParams<T> = {
  checkType: Check
  nodes: Node[]
  checksResult: NodeCheckResponse<T>[]
  blockchainID: string
  pocketSession: Session
  requestID: string
  applicationID: string
  applicationPublicKey: string
  elapsedTimes: number[]
}
