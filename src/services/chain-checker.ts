import { Configuration, HTTPMethod, Node, Pocket, PocketAAT, RelayResponse } from '@pokt-network/pocket-js'
import { MetricsRecorder } from '../services/metrics-recorder'
import { Redis } from 'ioredis'
import { blockHexToDecimal, checkEnforcementJSON } from '../utils'
import { createHash } from 'crypto'

const logger = require('../services/logger')

export class ChainChecker {
  redis: Redis
  metricsRecorder: MetricsRecorder

  constructor(redis: Redis, metricsRecorder: MetricsRecorder) {
    this.redis = redis
    this.metricsRecorder = metricsRecorder
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
  }: ChainIDFilterOptions): Promise<Node[]> {
    const CheckedNodes: Node[] = []
    let CheckedNodesList: string[] = []

    // Key is "chainID - a hash of the all the nodes in this session, sorted by public key"
    // Value is an array of node public keys that have passed Chain checks for this session in the past 5 minutes
    const CheckedNodesKey =
      chainID +
      '-' +
      createHash('sha256')
        .update(
          JSON.stringify(
            nodes.sort((a, b) => (a.publicKey > b.publicKey ? 1 : b.publicKey > a.publicKey ? -1 : 0)),
            (k, v) => (k !== 'publicKey' ? v : undefined)
          )
        )
        .digest('hex')
    const CheckedNodesCached = await this.redis.get(CheckedNodesKey)

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
    const ChainLock = await this.redis.get('lock-' + CheckedNodesKey)

    if (ChainLock) {
      return nodes
    } else {
      // Set lock as this thread checks the Chain with 60 second ttl.
      // If any major errors happen below, it will retry the Chain check every 60 seconds.
      await this.redis.set('lock-' + CheckedNodesKey, 'true', 'EX', 60)
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
      pocketConfiguration,
    }
    const nodeChainLogs = await this.getNodeChainLogs(options)

    // Go through nodes and add all nodes that are current or within 1 block -- this allows for block processing times
    for (const nodeChainLog of nodeChainLogs) {
      // const relayStart = process.hrtime()

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
            origin: 'chaincheck',
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
            origin: 'chaincheck',
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
      origin: 'chaincheck',
    })
    await this.redis.set(
      CheckedNodesKey,
      JSON.stringify(CheckedNodesList),
      'EX',
      CheckedNodes.length > 0 ? 600 : 30 // will retry Chain check every 30 seconds if no nodes are in Chain
    )

    // If one or more nodes of this session are not in Chain, fire a consensus relay with the same check.
    // This will penalize the out-of-Chain nodes and cause them to get slashed for reporting incorrect data.
    if (CheckedNodes.length < 5) {
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
        origin: 'chaincheck',
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
    pocketConfiguration,
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
        pocketConfiguration,
      }

      promiseStack.push(this.getNodeChainLog(options))
    }

    ;[rawNodeChainLogs[0], rawNodeChainLogs[1], rawNodeChainLogs[2], rawNodeChainLogs[3], rawNodeChainLogs[4]] =
      await Promise.all(promiseStack)

    for (const rawNodeChainLog of rawNodeChainLogs) {
      if (typeof rawNodeChainLog === 'object' && (rawNodeChainLog.chainID as unknown as string) !== '') {
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
  }: GetNodeChainLogOptions): Promise<NodeChainLog> {
    logger.log('info', 'CHAIN CHECK START', {
      requestID: requestID,
      relayType: '',
      typeID: '',
      serviceNode: node.publicKey,
      error: '',
      elapsedTime: '',
      blockchainID,
      origin: 'chaincheck',
    })

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
        origin: 'chaincheck',
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
        origin: 'chaincheck',
      })

      let error = relayResponse.message

      if (typeof relayResponse.message === 'object') {
        error = JSON.stringify(relayResponse.message)
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
        error,
        origin: 'chaincheck',
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
        origin: 'chaincheck',
      })

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
        error: JSON.stringify(relayResponse),
        origin: 'chaincheck',
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
}
