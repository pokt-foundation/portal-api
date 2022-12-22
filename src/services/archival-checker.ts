import {
  Relayer,
  InvalidSessionError,
  EvidenceSealedError,
  OutOfSyncRequestError,
} from '@pokt-foundation/pocketjs-relayer'
import { Session, Node, PocketAAT } from '@pokt-foundation/pocketjs-types'
import extractDomain from 'extract-domain'
import { removeChecksCache, removeNodeFromSession, removeSessionCache } from '../utils/cache'
import { CheckMethods, CHECK_TIMEOUT, PERCENTAGE_THRESHOLD_TO_REMOVE_SESSION } from '../utils/constants'
import { checkEnforcementJSON } from '../utils/enforcements'
import { getRandomAddress } from '../utils/evm/helpers'
import { CheckResult, RelayResponse } from '../utils/types'
import { Cache } from './cache'
import { MetricsRecorder } from './metrics-recorder'

const logger = require('../services/logger')

export class ArchivalChecker {
  cache: Cache
  metricsRecorder: MetricsRecorder
  origin: string
  sessionErrors: number

  constructor(cache: Cache, metricsRecorder: MetricsRecorder, origin: string) {
    this.cache = cache
    this.metricsRecorder = metricsRecorder
    this.origin = origin
  }

  async archivalModeFilter({
    nodes,
    requestID,
    blockchainID,
    relayer,
    applicationID,
    applicationPublicKey,
    pocketAAT,
    session,
    path,
    dynamicAddress = true,
  }: ArchivalModeFilterOptions): Promise<CheckResult> {
    const { key: sessionKey } = session

    const CheckedNodes: Node[] = []
    let CheckedNodesList: string[] = []

    // Value is an array of node public keys that have passed Chain checks for this session in the past 5 minutes
    const checkedNodesKey = `archival-check-${sessionKey}`
    const CheckedNodesCached = await this.cache.get(checkedNodesKey)

    const cached = Boolean(CheckedNodesCached)

    if (cached) {
      CheckedNodesList = JSON.parse(CheckedNodesCached)
      for (const node of nodes) {
        if (CheckedNodesList.includes(node.publicKey)) {
          CheckedNodes.push(node)
        }
      }

      return { nodes: CheckedNodes, cached }
    }

    // Cache is stale, start a new cache fill
    // First check cache lock key; if lock key exists, return full node set
    const ArchivalLock = await this.cache.get('lock-' + checkedNodesKey)

    if (ArchivalLock) {
      return { nodes, cached }
    } else {
      // Set lock as this thread checks the Chain with 60 second ttl.
      // If any major errors happen below, it will retry the ARCHIVAL CHECK every 60 seconds.
      await this.cache.set('lock-' + checkedNodesKey, 'true', 'EX', 60)
    }

    // Fires all Archival checks asynchronously then assembles the results
    const options: GetNodesArchivalLogsOptions = {
      nodes,
      requestID,
      blockchainID,
      applicationID,
      applicationPublicKey,
      relayer,
      pocketAAT,
      session,
      path,
      dynamicAddress,
    }
    const nodeArchivalLogs = await this.getNodeArchivalLogs(options)

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
    for (const nodeArchivalLog of nodeArchivalLogs) {
      const { node, error } = nodeArchivalLog
      const { serviceUrl: serviceURL } = node
      const serviceDomain = extractDomain(serviceURL)

      if (!error) {
        logger.log('info', `ARCHIVAL CHECK SUCCESS: ${node.publicKey}`, {
          requestID: requestID,
          serviceNode: node.publicKey,
          blockchainID,
          origin: this.origin,
          serviceURL,
          serviceDomain,
          sessionKey,
        })

        // Node is in archival mode: add to nodes list
        CheckedNodes.push(nodeArchivalLog.node)
        CheckedNodesList.push(nodeArchivalLog.node.publicKey)
      } else {
        logger.log('info', `ARCHIVAL CHECK FAILURE: ${nodeArchivalLog.node.publicKey}`, {
          requestID: requestID,
          serviceNode: nodeArchivalLog.node.publicKey,
          blockchainID,
          origin: this.origin,
          serviceURL,
          serviceDomain,
          sessionKey,
          error,
        })
      }
    }

    logger.log('info', 'ARCHIVAL CHECK COMPLETE: ' + CheckedNodes.length + ' nodes on chain', {
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
      CheckedNodes.length > 0 ? 600 : 30 // will retry ARCHIVAL CHECK every 30 seconds if no nodes are in Chain
    )

    // TODO: Implement Consensus challenge
    // If one or more nodes of this session are not in Chain, fire a consensus relay with the same check.
    // This will penalize the out-of-Chain nodes and cause them to get slashed for reporting incorrect data.

    return { nodes: CheckedNodes, cached }
  }

  async getNodeArchivalLogs({
    nodes,
    requestID,
    blockchainID,
    applicationID,
    applicationPublicKey,
    relayer,
    pocketAAT,
    session,
    path,
    dynamicAddress = true,
  }: GetNodesArchivalLogsOptions): Promise<NodeArchivalLog[]> {
    const nodeArchivalLogs: NodeArchivalLog[] = []
    const promiseStack: Promise<NodeArchivalLog>[] = []

    // Set to junk values first so that the Promise stack can fill them later
    const rawNodeArchivalLogs: NodeArchivalLog[] = [
      <NodeArchivalLog>{},
      <NodeArchivalLog>{},
      <NodeArchivalLog>{},
      <NodeArchivalLog>{},
      <NodeArchivalLog>{},
    ]

    for (const node of nodes) {
      const options: GetNodeArchivalLogOptions = {
        node,
        requestID,
        blockchainID,
        applicationID,
        applicationPublicKey,
        relayer,
        pocketAAT,
        session,
        path,
        dynamicAddress,
      }

      promiseStack.push(this.getNodeArchivalLog(options))
    }

    ;[
      rawNodeArchivalLogs[0],
      rawNodeArchivalLogs[1],
      rawNodeArchivalLogs[2],
      rawNodeArchivalLogs[3],
      rawNodeArchivalLogs[4],
      rawNodeArchivalLogs[5],
      rawNodeArchivalLogs[6],
      rawNodeArchivalLogs[8],
      rawNodeArchivalLogs[9],
      rawNodeArchivalLogs[10],
      rawNodeArchivalLogs[11],
      rawNodeArchivalLogs[12],
      rawNodeArchivalLogs[13],
      rawNodeArchivalLogs[14],
      rawNodeArchivalLogs[15],
      rawNodeArchivalLogs[16],
      rawNodeArchivalLogs[17],
      rawNodeArchivalLogs[18],
      rawNodeArchivalLogs[19],
      rawNodeArchivalLogs[20],
      rawNodeArchivalLogs[21],
      rawNodeArchivalLogs[22],
      rawNodeArchivalLogs[23],
    ] = await Promise.all(promiseStack)

    for (const rawNodeArchivalLog of rawNodeArchivalLogs) {
      // Only add nodes that are properly formatted and don't contain error
      if (typeof rawNodeArchivalLog === 'object' && (rawNodeArchivalLog?.error as unknown as string) === '') {
        nodeArchivalLogs.push(rawNodeArchivalLog)
      }
    }
    return nodeArchivalLogs
  }

  async getNodeArchivalLog({
    node,
    requestID,
    blockchainID,
    relayer,
    applicationID,
    applicationPublicKey,
    pocketAAT,
    session,
    path,
    dynamicAddress = true,
  }: GetNodeArchivalLogOptions): Promise<NodeArchivalLog> {
    const { key } = session || {}
    const { serviceUrl: serviceURL } = node
    const serviceDomain = extractDomain(serviceURL)

    // Pull the current block from each node using the blockchain's archival check payload as the relay
    const relayStart = process.hrtime()

    let relay: RelayResponse | Error

    // Only valid for EVM chains
    let address = getRandomAddress()

    if (!dynamicAddress) {
      address = '0xe5Fb31A5CaEE6a96de393bdBF89FBe65fe125Bb3'
    }

    const archivalCheckPayload = JSON.stringify({
      method: 'eth_getBalance',
      params: [address, '0x1'],
      id: 1,
      jsonrpc: '2.0',
    })

    try {
      relay = await relayer.relay({
        blockchain: blockchainID,
        data: archivalCheckPayload,
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

      const nodeArchivalLog = {
        node: node,
        error: '',
      } as NodeArchivalLog

      if (payload?.error?.message) {
        // Create a nodeArchivalLog for each node
        nodeArchivalLog.error = payload.error.message

        logger.log('info', 'ARCHIVAL CHECK RESULT: ' + JSON.stringify(nodeArchivalLog), {
          requestID: requestID,
          serviceNode: node.publicKey,
          blockchainID,
          origin: this.origin,
          serviceURL,
          serviceDomain,
          sessionKey: key,
        })
      }

      return nodeArchivalLog
    } else if (relay instanceof Error) {
      logger.log('error', 'ARCHIVAL CHECK ERROR: ' + JSON.stringify(relay), {
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
          bytes: Buffer.byteLength('NODE NOT ARCHIVAL', 'utf8'),
          fallback: false,
          method: CheckMethods.ChainCheck,
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
      logger.log('error', 'ARCHIVAL CHECK ERROR UNHANDLED: ' + JSON.stringify(relay), {
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
          bytes: Buffer.byteLength('NODE NOT ARCHIVAL', 'utf8'),
          fallback: false,
          method: CheckMethods.ChainCheck,
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
    const nodeArchivalLog = { node: node, error: 'missing trie node' } as NodeArchivalLog

    return nodeArchivalLog
  }
}

type NodeArchivalLog = {
  node: Node
  error: string
}

interface BaseArchivalLogOptions {
  requestID: string
  blockchainID: string
  applicationID: string
  applicationPublicKey: string
  relayer: Relayer
  pocketAAT: PocketAAT
  session: Session
  path?: string
  dynamicAddress: boolean
}

interface GetNodesArchivalLogsOptions extends BaseArchivalLogOptions {
  nodes: Node[]
}

interface GetNodeArchivalLogOptions extends BaseArchivalLogOptions {
  node: Node
}

export type ArchivalModeFilterOptions = {
  nodes: Node[]
  requestID: string
  blockchainID: string
  relayer: Relayer
  applicationID: string
  applicationPublicKey: string
  pocketAAT: PocketAAT
  session: Session
  path?: string
  dynamicAddress: boolean
}
