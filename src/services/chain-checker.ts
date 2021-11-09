import { Redis } from 'ioredis'
import { Configuration, HTTPMethod, Session, Node, Pocket, PocketAAT, RelayResponse } from '@pokt-network/pocket-js'
import { MetricsRecorder } from '../services/metrics-recorder'
import { blockHexToDecimal } from '../utils/block'
import { getNodeNetworkData, removeNodeFromSession } from '../utils/cache'
import { MAX_RELAYS_ERROR } from '../utils/constants'
import { checkEnforcementJSON } from '../utils/enforcements'
import { hashBlockchainNodes } from '../utils/helpers'

const logger = require('../services/logger')

export class ChainChecker {
  redis: Redis
  metricsRecorder: MetricsRecorder
  origin: string

  constructor(redis: Redis, metricsRecorder: MetricsRecorder, origin: string) {
    this.redis = redis
    this.metricsRecorder = metricsRecorder
    this.origin = origin
  }

  async chainIDFilter({
    nodes,
    requestID,
    chainCheck,
    chainID,
    blockchainID,
    pocket,
    applicationID,
    applicationPublicKey,
    pocketAAT,
    pocketConfiguration,
    pocketSession,
  }: ChainIDFilterOptions): Promise<Node[]> {
    const { sessionKey } = pocketSession

    const blockchainHash = hashBlockchainNodes(blockchainID, pocketSession.sessionNodes)

    const CheckedNodes: Node[] = []
    let CheckedNodesList: string[] = []

    // Value is an array of node public keys that have passed Chain checks for this session in the past 5 minutes
    const checkedNodesKey = `chain-check-${blockchainHash}`
    const CheckedNodesCached = await this.redis.get(checkedNodesKey)

    if (CheckedNodesCached) {
      CheckedNodesList = JSON.parse(CheckedNodesCached)
      for (const node of nodes) {
        if (CheckedNodesList.includes(node.publicKey)) {
          CheckedNodes.push(node)
        }
      }
      // logger.log('info', 'CHAIN CHECK CACHE: ' + CheckedNodes.length + ' nodes returned');
      return CheckedNodes
    }

    // Cache is stale, start a new cache fill
    // First check cache lock key; if lock key exists, return full node set
    const ChainLock = await this.redis.get('lock-' + checkedNodesKey)

    if (ChainLock) {
      return nodes
    } else {
      // Set lock as this thread checks the Chain with 60 second ttl.
      // If any major errors happen below, it will retry the Chain check every 60 seconds.
      await this.redis.set('lock-' + checkedNodesKey, 'true', 'EX', 60)
    }

    // Fires all 5 Chain checks Chainhronously then assembles the results
    const options: GetNodesChainLogsOptions = {
      nodes,
      requestID,
      chainCheck,
      blockchainID,
      applicationID,
      applicationPublicKey,
      pocket,
      pocketAAT,
      blockchainHash,
      pocketConfiguration,
      pocketSession,
    }
    const nodeChainLogs = await this.getNodeChainLogs(options)

    // Go through nodes and add all nodes that are current or within 1 block -- this allows for block processing times
    for (const nodeChainLog of nodeChainLogs) {
      // const relayStart = process.hrtime()

      const { serviceURL, serviceDomain } = await getNodeNetworkData(this.redis, nodeChainLog.node.publicKey, requestID)

      if (nodeChainLog.chainID === chainID) {
        logger.log(
          'info',
          'CHAIN CHECK SUCCESS: ' + nodeChainLog.node.publicKey + ' chainID: ' + nodeChainLog.chainID,
          {
            requestID: requestID,
            relayType: '',
            typeID: '',
            serviceNode: nodeChainLog.node.publicKey,
            error: '',
            elapsedTime: '',
            blockchainID,
            origin: this.origin,
            serviceURL,
            serviceDomain,
            blockchainHash,
          }
        )

        // Correct chain: add to nodes list
        CheckedNodes.push(nodeChainLog.node)
        CheckedNodesList.push(nodeChainLog.node.publicKey)
      } else {
        logger.log(
          'info',
          'CHAIN CHECK FAILURE: ' + nodeChainLog.node.publicKey + ' chainID: ' + nodeChainLog.chainID,
          {
            requestID: requestID,
            relayType: '',
            typeID: '',
            serviceNode: nodeChainLog.node.publicKey,
            error: '',
            elapsedTime: '',
            blockchainID,
            origin: this.origin,
            serviceURL,
            serviceDomain,
            blockchainHash,
          }
        )
      }
    }

    logger.log('info', 'CHAIN CHECK COMPLETE: ' + CheckedNodes.length + ' nodes on chain', {
      requestID: requestID,
      relayType: '',
      typeID: '',
      serviceNode: '',
      error: '',
      elapsedTime: '',
      blockchainID,
      origin: this.origin,
      blockchainHash,
    })
    await this.redis.set(
      checkedNodesKey,
      JSON.stringify(CheckedNodesList),
      'EX',
      CheckedNodes.length > 0 ? 600 : 30 // will retry Chain check every 30 seconds if no nodes are in Chain
    )

    // If one or more nodes of this session are not in Chain, fire a consensus relay with the same check.
    // This will penalize the out-of-Chain nodes and cause them to get slashed for reporting incorrect data.
    if (CheckedNodes.length < nodes.length) {
      const consensusResponse = await pocket.sendRelay(
        chainCheck,
        blockchainID,
        pocketAAT,
        this.updateConfigurationConsensus(pocketConfiguration),
        undefined,
        'POST' as HTTPMethod,
        undefined,
        undefined,
        true
      )

      logger.log('info', 'CHAIN CHECK CHALLENGE: ' + JSON.stringify(consensusResponse), {
        requestID: requestID,
        relayType: '',
        typeID: '',
        serviceNode: '',
        error: '',
        elapsedTime: '',
        blockchainID,
        origin: this.origin,
        blockchainHash,
      })
    }
    return CheckedNodes
  }

  async getNodeChainLogs({
    nodes,
    requestID,
    chainCheck,
    blockchainID,
    applicationID,
    applicationPublicKey,
    pocket,
    pocketAAT,
    blockchainHash,
    pocketConfiguration,
    pocketSession,
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
        pocket,
        pocketAAT,
        blockchainHash,
        pocketConfiguration,
        pocketSession,
      }

      promiseStack.push(this.getNodeChainLog(options))
    }

    ;[rawNodeChainLogs[0], rawNodeChainLogs[1], rawNodeChainLogs[2], rawNodeChainLogs[3], rawNodeChainLogs[4]] =
      await Promise.all(promiseStack)

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
    pocket,
    applicationID,
    applicationPublicKey,
    pocketAAT,
    pocketConfiguration,
    pocketSession,
  }: GetNodeChainLogOptions): Promise<NodeChainLog> {
    const { sessionKey, sessionNodes } = pocketSession || {}
    // Pull the current block from each node using the blockchain's chainCheck as the relay
    const relayStart = process.hrtime()

    const relayResponse = await pocket.sendRelay(
      chainCheck,
      blockchainID,
      pocketAAT,
      this.updateConfigurationTimeout(pocketConfiguration),
      undefined,
      'POST' as HTTPMethod,
      undefined,
      node,
      false,
      undefined
    )

    const { serviceURL, serviceDomain } = await getNodeNetworkData(this.redis, node.publicKey, requestID)

    if (relayResponse instanceof RelayResponse && checkEnforcementJSON(relayResponse.payload)) {
      const payload = JSON.parse(relayResponse.payload)

      // Create a NodeChainLog for each node with current chainID
      const nodeChainLog = {
        node: node,
        chainID: blockHexToDecimal(payload.result),
      } as NodeChainLog

      logger.log('info', 'CHAIN CHECK RESULT: ' + JSON.stringify(nodeChainLog), {
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
        sessionKey,
      })

      // Success
      return nodeChainLog
    } else if (relayResponse instanceof Error) {
      logger.log('error', 'CHAIN CHECK ERROR: ' + JSON.stringify(relayResponse), {
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
        sessionKey,
      })

      let error = relayResponse.message

      if (error === MAX_RELAYS_ERROR) {
        await removeNodeFromSession(this.redis, blockchainID, sessionNodes, node.publicKey)
      }

      if (typeof relayResponse.message === 'object') {
        error = JSON.stringify(relayResponse.message)
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
          delivered: false,
          fallback: false,
          method: 'chaincheck',
          error,
          origin: this.origin,
          data: undefined,
          pocketSession,
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
      logger.log('error', 'CHAIN CHECK ERROR UNHANDLED: ' + JSON.stringify(relayResponse), {
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
        sessionKey,
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
          delivered: false,
          fallback: false,
          method: 'chaincheck',
          error: JSON.stringify(relayResponse),
          origin: this.origin,
          data: undefined,
          pocketSession,
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

  updateConfigurationConsensus(pocketConfiguration: Configuration): Configuration {
    return new Configuration(
      pocketConfiguration.maxDispatchers,
      pocketConfiguration.maxSessions,
      5,
      2000,
      false,
      pocketConfiguration.sessionBlockFrequency,
      pocketConfiguration.blockTime,
      pocketConfiguration.maxSessionRefreshRetries,
      pocketConfiguration.validateRelayResponses,
      pocketConfiguration.rejectSelfSignedCertificates
    )
  }

  updateConfigurationTimeout(pocketConfiguration: Configuration): Configuration {
    return new Configuration(
      pocketConfiguration.maxDispatchers,
      pocketConfiguration.maxSessions,
      pocketConfiguration.consensusNodeCount,
      4000,
      pocketConfiguration.acceptDisputedResponses,
      pocketConfiguration.sessionBlockFrequency,
      pocketConfiguration.blockTime,
      pocketConfiguration.maxSessionRefreshRetries,
      pocketConfiguration.validateRelayResponses,
      pocketConfiguration.rejectSelfSignedCertificates
    )
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
  pocket: Pocket
  pocketAAT: PocketAAT
  pocketConfiguration: Configuration
  blockchainHash: string
  pocketSession: Session
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
  pocket: Pocket
  applicationID: string
  applicationPublicKey: string
  pocketAAT: PocketAAT
  pocketConfiguration: Configuration
  pocketSession: Session
}
