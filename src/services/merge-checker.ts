import {
  Relayer,
  InvalidSessionError,
  EvidenceSealedError,
  OutOfSyncRequestError,
} from '@pokt-foundation/pocketjs-relayer'
import { Session, Node, PocketAAT } from '@pokt-foundation/pocketjs-types'
import extractDomain from 'extract-domain'
import { MetricsRecorder } from '../services/metrics-recorder'
import { blockHexToDecimal } from '../utils/block'
import { removeChecksCache, removeNodeFromSession, removeSessionCache } from '../utils/cache'
import {
  CheckMethods,
  CHECK_TIMEOUT,
  ETHEREUM_BLOCKCHAIN_IDS,
  GNOSIS_BLOCKCHAIN_IDS,
  PERCENTAGE_THRESHOLD_TO_REMOVE_SESSION,
} from '../utils/constants'
import { checkEnforcementJSON } from '../utils/enforcements'
import { CheckResult, RelayResponse } from '../utils/types'
import { Cache } from './cache'

const logger = require('../services/logger')

const MERGE_BLOCK_NUMBER = {
  ethereum: 15537394,
  gnosis: 25349536,
}

const TERMINAL_TOTAL_DIFFICULTY = {
  ethereum: BigInt('58750003716598352816469'),
  gnosis: BigInt('8626000110427538733349499292577475819600160930'),
}

const MERGE_CHECK_PAYLOAD = JSON.stringify({
  jsonrpc: '2.0',
  method: 'eth_getBlockByNumber',
  params: ['latest', false],
  id: 1,
})

export class MergeChecker {
  cache: Cache
  metricsRecorder: MetricsRecorder
  origin: string
  sessionErrors: number

  constructor(cache: Cache, metricsRecorder: MetricsRecorder, origin: string) {
    this.cache = cache
    this.metricsRecorder = metricsRecorder
    this.origin = origin
  }

  async mergeStatusFilter({
    nodes,
    requestID,
    blockchainID,
    relayer,
    applicationID,
    applicationPublicKey,
    pocketAAT,
    session,
    path,
  }: MergeFilterOptions): Promise<CheckResult> {
    const { key: sessionKey } = session

    const CheckedNodes: Node[] = []
    let CheckedNodesList: string[] = []

    // Value is an array of node public keys that have passed Merge checks for this session in the past 5 minutes
    const checkedNodesKey = `merge-check-${sessionKey}`
    const CheckedNodesCached = await this.cache.get(checkedNodesKey)

    const cached = Boolean(CheckedNodesCached)

    if (cached) {
      CheckedNodesList = JSON.parse(CheckedNodesCached)
      for (const node of nodes) {
        if (CheckedNodesList.includes(node.publicKey)) {
          CheckedNodes.push(node)
        }
      }
      // logger.log('info', 'MERGE CHECK CACHE: ' + CheckedNodes.length + ' nodes returned');
      return { nodes: CheckedNodes, cached }
    }

    // Cache is stale, start a new cache fill
    // First check cache lock key; if lock key exists, return full node set
    const MergeLock = await this.cache.get('lock-' + checkedNodesKey)

    if (MergeLock) {
      return { nodes, cached }
    } else {
      // Set lock as this thread checks the Merge status with 60 second ttl.
      // If any major errors happen below, it will retry the Chain check every 60 seconds.
      await this.cache.set('lock-' + checkedNodesKey, 'true', 'EX', 60)
    }

    // Fires all Merge checks then assembles the results
    const options: GetNodesMergeLogsOptions = {
      nodes,
      requestID,
      blockchainID,
      applicationID,
      applicationPublicKey,
      relayer,
      pocketAAT,
      session,
      path,
    }
    const nodeMergeLogs = await this.getMergeCheckLogs(options)

    // Check for percentange of check session errors to determined if session should be
    // removed, as pocket nodes might get out of sync during session rollovers and
    // return they incorrectly do not belong to the current session
    const nodeErrorsToNodesRatio = this.sessionErrors / nodes.length

    if (nodeErrorsToNodesRatio >= PERCENTAGE_THRESHOLD_TO_REMOVE_SESSION) {
      logger.log('warn', 'SESSION: whole session removed from cache due to errors', {
        requestID,
        typeID: applicationID,
        blockchainID,
        origin: this.origin,
        sessionKey: session.key,
        sessionBlockHeight: session.blockHeight,
        sessionPublicKey: session.header.applicationPubKey,
      })

      await removeSessionCache(this.cache, pocketAAT.applicationPublicKey, blockchainID)
      await removeChecksCache(this.cache, session.key, session.nodes)
    }

    // Go through nodes and add all nodes that are current or within 1 block -- this allows for block processing times
    for (const nodeMergeLog of nodeMergeLogs) {
      const { node, totalDifficulty: nodeTotalDifficulty, blockNumber: nodeBlockNumber } = nodeMergeLog
      const { serviceUrl: serviceURL } = node
      const serviceDomain = extractDomain(serviceURL)

      let blockchain = ''

      if (ETHEREUM_BLOCKCHAIN_IDS.includes(blockchainID)) {
        blockchain = 'ethereum'
      } else if (GNOSIS_BLOCKCHAIN_IDS.includes(blockchainID)) {
        blockchain = 'gnosis'
      }

      if (
        BigInt(nodeTotalDifficulty) === TERMINAL_TOTAL_DIFFICULTY[blockchain] &&
        nodeBlockNumber >= MERGE_BLOCK_NUMBER[blockchain]
      ) {
        logger.log(
          'info',
          'MERGE CHECK SUCCESS: ' +
            node.publicKey +
            ' difficulty: ' +
            BigInt(nodeTotalDifficulty) +
            ' block number: ' +
            nodeBlockNumber,
          {
            requestID: requestID,
            serviceNode: node.publicKey,
            blockchainID,
            origin: this.origin,
            serviceURL,
            serviceDomain,
            sessionKey,
          }
        )

        // Pass merge check: add to nodes list
        CheckedNodes.push(nodeMergeLog.node)
        CheckedNodesList.push(nodeMergeLog.node.publicKey)
      } else {
        logger.log(
          'info',
          'MERGE CHECK FAILURE: ' +
            nodeMergeLog.node.publicKey +
            ' difficulty: ' +
            BigInt(nodeTotalDifficulty) +
            ' block number: ' +
            nodeBlockNumber,
          {
            requestID: requestID,
            serviceNode: nodeMergeLog.node.publicKey,
            blockchainID,
            origin: this.origin,
            serviceURL,
            serviceDomain,
            sessionKey,
          }
        )
      }
    }

    logger.log('info', 'MERGE CHECK COMPLETE: ' + CheckedNodes.length + ' nodes properly merged', {
      requestID: requestID,
      typeID: applicationID,
      blockchainID,
      origin: this.origin,
      applicationPublicKey: pocketAAT.applicationPublicKey,
      sessionKey,
    })
    await this.cache.set(
      checkedNodesKey,
      JSON.stringify(CheckedNodesList),
      'EX',
      CheckedNodes.length > 0 ? 600 : 30 // will retry Merge check every 30 seconds if no nodes are merged
    )

    // TODO: Implement Consensus challenge
    // If one or more nodes of this session are not merged, fire a consensus relay with the same check.
    // This will penalize the unmerged nodes and cause them to get slashed for reporting incorrect data.

    return { nodes: CheckedNodes, cached }
  }

  async getMergeCheckLogs({
    nodes,
    requestID,
    blockchainID,
    applicationID,
    applicationPublicKey,
    relayer,
    pocketAAT,
    session,
    path,
  }: GetNodesMergeLogsOptions): Promise<MergeCheckLog[]> {
    const nodeMergeLogs: MergeCheckLog[] = []
    const promiseStack: Promise<MergeCheckLog>[] = []

    // Set to junk values first so that the Promise stack can fill them later
    const rawNodeMergeLogs: MergeCheckLog[] = [
      <MergeCheckLog>{},
      <MergeCheckLog>{},
      <MergeCheckLog>{},
      <MergeCheckLog>{},
      <MergeCheckLog>{},
    ]

    for (const node of nodes) {
      const options: GetNodeMergeLogOptions = {
        node,
        requestID,
        blockchainID,
        applicationID,
        applicationPublicKey,
        relayer,
        pocketAAT,
        session,
        path,
      }

      promiseStack.push(this.getNodeMergeLog(options))
    }

    ;[
      rawNodeMergeLogs[0],
      rawNodeMergeLogs[1],
      rawNodeMergeLogs[2],
      rawNodeMergeLogs[3],
      rawNodeMergeLogs[4],
      rawNodeMergeLogs[5],
      rawNodeMergeLogs[6],
      rawNodeMergeLogs[8],
      rawNodeMergeLogs[9],
      rawNodeMergeLogs[10],
      rawNodeMergeLogs[11],
      rawNodeMergeLogs[12],
      rawNodeMergeLogs[13],
      rawNodeMergeLogs[14],
      rawNodeMergeLogs[15],
      rawNodeMergeLogs[16],
      rawNodeMergeLogs[17],
      rawNodeMergeLogs[18],
      rawNodeMergeLogs[19],
      rawNodeMergeLogs[20],
      rawNodeMergeLogs[21],
      rawNodeMergeLogs[22],
      rawNodeMergeLogs[23],
    ] = await Promise.all(promiseStack)

    for (const rawNodeMergeLog of rawNodeMergeLogs) {
      if (typeof rawNodeMergeLog === 'object' && (rawNodeMergeLog?.totalDifficulty as unknown as string) !== '') {
        nodeMergeLogs.push(rawNodeMergeLog)
      }
    }
    return nodeMergeLogs
  }

  async getNodeMergeLog({
    node,
    requestID,
    blockchainID,
    relayer,
    applicationID,
    applicationPublicKey,
    pocketAAT,
    session,
    path,
  }: GetNodeMergeLogOptions): Promise<MergeCheckLog> {
    const { key } = session || {}
    const { serviceUrl: serviceURL } = node
    const serviceDomain = extractDomain(serviceURL)

    // Pull the difficulty from each node using the merge check payload as the relay
    const relayStart = process.hrtime()

    let relay: RelayResponse | Error

    try {
      relay = await relayer.relay({
        blockchain: blockchainID,
        data: MERGE_CHECK_PAYLOAD,
        method: '',
        path,
        node,
        pocketAAT,
        session: session,
        options: {
          retryAttempts: 1,
          rejectSelfSignedCertificates: false,
          timeout: CHECK_TIMEOUT,
        },
      })
    } catch (error) {
      relay = error
    }

    if (!(relay instanceof Error) && checkEnforcementJSON(relay.response)) {
      const payload = JSON.parse(relay.response)

      // Create a NodeMergeLog for each node with difficulty and block number
      const nodeMergeLog = {
        node: node,
        totalDifficulty: String(payload.result.totalDifficulty),
        blockNumber: blockHexToDecimal(payload.result.number),
      } as MergeCheckLog

      logger.log('info', 'MERGE CHECK RESULT: ' + JSON.stringify(nodeMergeLog), {
        requestID: requestID,
        serviceNode: node.publicKey,
        blockchainID,
        origin: this.origin,
        serviceURL,
        serviceDomain,
        sessionKey: key,
      })

      // Success
      return nodeMergeLog
    } else if (relay instanceof Error) {
      logger.log('error', 'MERGE CHECK ERROR: ' + JSON.stringify(relay), {
        requestID: requestID,
        serviceNode: node.publicKey,
        blockchainID,
        origin: this.origin,
        serviceURL,
        serviceDomain,
        sessionKey: key,
      })

      if (relay instanceof EvidenceSealedError) {
        await removeNodeFromSession(this.cache, session, node.publicKey, true, requestID, blockchainID)
      }
      if (relay instanceof InvalidSessionError || relay instanceof OutOfSyncRequestError) {
        this.sessionErrors++
      }

      this.metricsRecorder
        .recordMetric({
          requestID: requestID,
          applicationID: applicationID,
          applicationPublicKey: applicationPublicKey,
          blockchain: undefined,
          blockchainID,
          serviceNode: node.publicKey,
          relayStart,
          result: 500,
          bytes: Buffer.byteLength('NOT MERGED CHAIN', 'utf8'),
          fallback: false,
          method: CheckMethods.MergeCheck,
          error: typeof relay.message === 'object' ? JSON.stringify(relay.message) : relay.message,
          code: undefined,
          origin: this.origin,
          session,
        })
        .catch(function log(e) {
          logger.log('error', 'Error recording metrics: ' + e, {
            requestID: requestID,
            relayType: 'APP',
            typeID: applicationID,
            serviceNode: node.publicKey,
          })
        })
    } else {
      logger.log('error', 'MERGE CHECK ERROR UNHANDLED: ' + JSON.stringify(relay), {
        requestID: requestID,
        serviceNode: node.publicKey,
        blockchainID,
        origin: this.origin,
        serviceURL,
        serviceDomain,
        sessionKey: key,
      })

      this.metricsRecorder
        .recordMetric({
          requestID: requestID,
          applicationID: applicationID,
          applicationPublicKey: applicationPublicKey,
          blockchain: undefined,
          blockchainID,
          serviceNode: node.publicKey,
          relayStart,
          result: 500,
          bytes: Buffer.byteLength('NOT MERGED CHAIN', 'utf8'),
          fallback: false,
          method: CheckMethods.MergeCheck,
          error: JSON.stringify(relay),
          code: undefined,
          origin: this.origin,
          session,
        })
        .catch(function log(e) {
          logger.log('error', 'Error recording metrics: ' + e, {
            requestID: requestID,
            relayType: 'APP',
            typeID: applicationID,
            serviceNode: node.publicKey,
          })
        })
    }
    // Failed
    const nodeMergeLog = { node: node, totalDifficulty: '0', blockNumber: 0 } as MergeCheckLog

    return nodeMergeLog
  }
}

type MergeCheckLog = {
  node: Node
  totalDifficulty: string
  blockNumber: number
}

interface BaseMergeLogOptions {
  requestID: string
  blockchainID: string
  applicationID: string
  applicationPublicKey: string
  relayer: Relayer
  pocketAAT: PocketAAT
  session: Session
  path?: string
}

interface GetNodesMergeLogsOptions extends BaseMergeLogOptions {
  nodes: Node[]
}

interface GetNodeMergeLogOptions extends BaseMergeLogOptions {
  node: Node
}

export type MergeFilterOptions = {
  nodes: Node[]
  requestID: string
  blockchainID: string
  relayer: Relayer
  applicationID: string
  applicationPublicKey: string
  pocketAAT: PocketAAT
  session: Session
  path?: string
}
