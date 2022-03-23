import {
  Relayer,
  InvalidSessionError,
  EvidenceSealedError,
  OutOfSyncRequestError,
} from '@pokt-foundation/pocketjs-relayer'
import { Session, Node, PocketAAT } from '@pokt-foundation/pocketjs-types'
import extractDomain from 'extract-domain'
import { Redis } from 'ioredis'
import { MetricsRecorder } from '../services/metrics-recorder'
import { blockHexToDecimal } from '../utils/block'
import { removeChecksCache, removeNodeFromSession, removeSessionCache } from '../utils/cache'
import { CHECK_TIMEOUT, PERCENTAGE_THRESHOLD_TO_REMOVE_SESSION } from '../utils/constants'
import { checkEnforcementJSON } from '../utils/enforcements'
import { CheckResult, RelayResponse } from '../utils/types'

const logger = require('../services/logger')

export class ChainChecker {
  redis: Redis
  metricsRecorder: MetricsRecorder
  origin: string
  sessionErrors: number

  constructor(redis: Redis, metricsRecorder: MetricsRecorder, origin: string) {
    this.redis = redis
    this.metricsRecorder = metricsRecorder
    this.origin = origin
    this.sessionErrors = 0
  }

  async chainIDFilter({
    nodes,
    requestID,
    chainCheck,
    chainID,
    blockchainID,
    relayer,
    applicationID,
    applicationPublicKey,
    pocketAAT,
    session,
    path,
  }: ChainIDFilterOptions): Promise<CheckResult> {
    const { key: sessionKey } = session

    const CheckedNodes: Node[] = []
    let CheckedNodesList: string[] = []

    // Value is an array of node public keys that have passed Chain checks for this session in the past 5 minutes
    const checkedNodesKey = `chain-check-${sessionKey}`
    const CheckedNodesCached = await this.redis.get(checkedNodesKey)

    const cached = Boolean(CheckedNodesCached)

    if (cached) {
      CheckedNodesList = JSON.parse(CheckedNodesCached)
      for (const node of nodes) {
        if (CheckedNodesList.includes(node.publicKey)) {
          CheckedNodes.push(node)
        }
      }
      // logger.log('info', 'CHAIN CHECK CACHE: ' + CheckedNodes.length + ' nodes returned');
      return { nodes: CheckedNodes, cached }
    }

    // Cache is stale, start a new cache fill
    // First check cache lock key; if lock key exists, return full node set
    const ChainLock = await this.redis.get('lock-' + checkedNodesKey)

    if (ChainLock) {
      return { nodes, cached }
    } else {
      // Set lock as this thread checks the Chain with 60 second ttl.
      // If any major errors happen below, it will retry the Chain check every 60 seconds.
      await this.redis.set('lock-' + checkedNodesKey, 'true', 'EX', 60)
    }

    // Fires all Chain checks Chainhronously then assembles the results
    const options: GetNodesChainLogsOptions = {
      nodes,
      requestID,
      chainCheck,
      blockchainID,
      applicationID,
      applicationPublicKey,
      relayer,
      pocketAAT,
      session,
      path,
    }
    const nodeChainLogs = await this.getNodeChainLogs(options)

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

      await removeSessionCache(this.redis, pocketAAT.applicationPublicKey, blockchainID)
      await removeChecksCache(this.redis, session.key, session.nodes)
    }

    // Go through nodes and add all nodes that are current or within 1 block -- this allows for block processing times
    for (const nodeChainLog of nodeChainLogs) {
      const { node, chainID: nodeChainID } = nodeChainLog
      const { serviceUrl: serviceURL } = node
      const serviceDomain = extractDomain(serviceURL)

      if (nodeChainID === chainID) {
        logger.log('info', 'CHAIN CHECK SUCCESS: ' + node.publicKey + ' chainID: ' + nodeChainID, {
          requestID: requestID,
          serviceNode: node.publicKey,
          blockchainID,
          origin: this.origin,
          serviceURL,
          serviceDomain,
          sessionKey,
        })

        // Correct chain: add to nodes list
        CheckedNodes.push(nodeChainLog.node)
        CheckedNodesList.push(nodeChainLog.node.publicKey)
      } else {
        logger.log(
          'info',
          'CHAIN CHECK FAILURE: ' + nodeChainLog.node.publicKey + ' chainID: ' + nodeChainLog.chainID,
          {
            requestID: requestID,
            serviceNode: nodeChainLog.node.publicKey,
            blockchainID,
            origin: this.origin,
            serviceURL,
            serviceDomain,
            sessionKey,
          }
        )
      }
    }

    logger.log('info', 'CHAIN CHECK COMPLETE: ' + CheckedNodes.length + ' nodes on chain', {
      requestID: requestID,
      blockchainID,
      origin: this.origin,
      sessionKey,
    })
    await this.redis.set(
      checkedNodesKey,
      JSON.stringify(CheckedNodesList),
      'EX',
      CheckedNodes.length > 0 ? 600 : 30 // will retry Chain check every 30 seconds if no nodes are in Chain
    )

    // TODO: Implement Consensus challenge
    // If one or more nodes of this session are not in Chain, fire a consensus relay with the same check.
    // This will penalize the out-of-Chain nodes and cause them to get slashed for reporting incorrect data.

    return { nodes: CheckedNodes, cached }
  }

  async getNodeChainLogs({
    nodes,
    requestID,
    chainCheck,
    blockchainID,
    applicationID,
    applicationPublicKey,
    relayer,
    pocketAAT,
    session,
    path,
  }: GetNodesChainLogsOptions): Promise<NodeChainLog[]> {
    const nodeChainLogs: NodeChainLog[] = []
    const promiseStack: Promise<NodeChainLog>[] = []

    // Set to junk values first so that the Promise stack can fill them later
    const rawNodeChainLogs: NodeChainLog[] = [
      <NodeChainLog>{},
      <NodeChainLog>{},
      <NodeChainLog>{},
      <NodeChainLog>{},
      <NodeChainLog>{},
    ]

    for (const node of nodes) {
      const options: GetNodeChainLogOptions = {
        node,
        requestID,
        chainCheck,
        blockchainID,
        applicationID,
        applicationPublicKey,
        relayer,
        pocketAAT,
        session,
        path,
      }

      promiseStack.push(this.getNodeChainLog(options))
    }

    ;[
      rawNodeChainLogs[0],
      rawNodeChainLogs[1],
      rawNodeChainLogs[2],
      rawNodeChainLogs[3],
      rawNodeChainLogs[4],
      rawNodeChainLogs[5],
      rawNodeChainLogs[6],
      rawNodeChainLogs[8],
      rawNodeChainLogs[9],
      rawNodeChainLogs[10],
      rawNodeChainLogs[11],
      rawNodeChainLogs[12],
      rawNodeChainLogs[13],
      rawNodeChainLogs[14],
      rawNodeChainLogs[15],
      rawNodeChainLogs[16],
      rawNodeChainLogs[17],
      rawNodeChainLogs[18],
      rawNodeChainLogs[19],
      rawNodeChainLogs[20],
      rawNodeChainLogs[21],
      rawNodeChainLogs[22],
      rawNodeChainLogs[23],
    ] = await Promise.all(promiseStack)

    for (const rawNodeChainLog of rawNodeChainLogs) {
      if (typeof rawNodeChainLog === 'object' && (rawNodeChainLog?.chainID as unknown as string) !== '') {
        nodeChainLogs.push(rawNodeChainLog)
      }
    }
    return nodeChainLogs
  }

  async getNodeChainLog({
    node,
    requestID,
    chainCheck,
    blockchainID,
    relayer,
    applicationID,
    applicationPublicKey,
    pocketAAT,
    session,
    path,
  }: GetNodeChainLogOptions): Promise<NodeChainLog> {
    const { key } = session || {}
    const { serviceUrl: serviceURL } = node
    const serviceDomain = extractDomain(serviceURL)

    // Pull the current block from each node using the blockchain's chainCheck as the relay
    const relayStart = process.hrtime()

    let relay: RelayResponse | Error

    try {
      relay = await relayer.relay({
        blockchain: blockchainID,
        data: chainCheck,
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

      // Create a NodeChainLog for each node with current chainID
      const nodeChainLog = {
        node: node,
        chainID: blockHexToDecimal(payload.result),
      } as NodeChainLog

      logger.log('info', 'CHAIN CHECK RESULT: ' + JSON.stringify(nodeChainLog), {
        requestID: requestID,
        serviceNode: node.publicKey,
        blockchainID,
        origin: this.origin,
        serviceURL,
        serviceDomain,
        sessionKey: key,
      })

      // Success
      return nodeChainLog
    } else if (relay instanceof Error) {
      logger.log('error', 'CHAIN CHECK ERROR: ' + JSON.stringify(relay), {
        requestID: requestID,
        serviceNode: node.publicKey,
        blockchainID,
        origin: this.origin,
        serviceURL,
        serviceDomain,
        sessionKey: key,
      })

      if (relay instanceof EvidenceSealedError) {
        await removeNodeFromSession(this.redis, session, node.publicKey, true, requestID, blockchainID)
      }

      if (relay instanceof InvalidSessionError || relay instanceof OutOfSyncRequestError) {
        this.sessionErrors++
      }

      this.metricsRecorder
        .recordMetric({
          requestID: requestID,
          applicationID: applicationID,
          applicationPublicKey: applicationPublicKey,
          blockchainID,
          serviceNode: node.publicKey,
          relayStart,
          result: 500,
          bytes: Buffer.byteLength('WRONG CHAIN', 'utf8'),
          fallback: false,
          method: 'chaincheck',
          error: typeof relay.message === 'object' ? JSON.stringify(relay.message) : relay.message,
          code: undefined,
          origin: this.origin,
          data: undefined,
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
      logger.log('error', 'CHAIN CHECK ERROR UNHANDLED: ' + JSON.stringify(relay), {
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
          blockchainID,
          serviceNode: node.publicKey,
          relayStart,
          result: 500,
          bytes: Buffer.byteLength('WRONG CHAIN', 'utf8'),
          fallback: false,
          method: 'chaincheck',
          error: JSON.stringify(relay),
          code: undefined,
          origin: this.origin,
          data: undefined,
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
    const nodeChainLog = { node: node, chainID: 0 } as NodeChainLog

    return nodeChainLog
  }
}

type NodeChainLog = {
  node: Node
  chainID: number
}

interface BaseChainLogOptions {
  requestID: string
  chainCheck: string
  blockchainID: string
  applicationID: string
  applicationPublicKey: string
  relayer: Relayer
  pocketAAT: PocketAAT
  session: Session
  path?: string
}

interface GetNodesChainLogsOptions extends BaseChainLogOptions {
  nodes: Node[]
}

interface GetNodeChainLogOptions extends BaseChainLogOptions {
  node: Node
}

export type ChainIDFilterOptions = {
  nodes: Node[]
  requestID: string
  chainCheck: string
  chainID: number
  blockchainID: string
  relayer: Relayer
  applicationID: string
  applicationPublicKey: string
  pocketAAT: PocketAAT
  session: Session
  path?: string
}
