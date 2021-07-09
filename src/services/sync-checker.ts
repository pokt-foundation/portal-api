import { Configuration, HTTPMethod, Node, Pocket, PocketAAT, RelayResponse } from '@pokt-network/pocket-js'
import { MetricsRecorder } from '../services/metrics-recorder'
import { Redis } from 'ioredis'
import { checkEnforcementJSON } from '../utils'
var crypto = require('crypto')

const logger = require('../services/logger')
import axios from 'axios'

export class SyncChecker {
  redis: Redis
  metricsRecorder: MetricsRecorder

  constructor(redis: Redis, metricsRecorder: MetricsRecorder) {
    this.redis = redis
    this.metricsRecorder = metricsRecorder
  }

  async consensusFilter({
    nodes,
    requestID,
    syncCheck,
    syncCheckPath,
    syncAllowance = 5,
    blockchain,
    blockchainSyncBackup,
    applicationID,
    applicationPublicKey,
    pocket,
    pocketAAT,
    pocketConfiguration,
  }: ConsensusFilterOptions): Promise<Node[]> {
    // Blockchain records passed in with 0 sync allowance are missing the 'syncAllowance' field in MongoDB
    if (syncAllowance <= 0) {
      syncAllowance = 5
    }

    let syncedNodes: Node[] = []
    let syncedNodesList: String[] = []

    // Key is "blockchain - a hash of the all the nodes in this session, sorted by public key"
    // Value is an array of node public keys that have passed sync checks for this session in the past 5 minutes

    const sortedNodes = nodes.sort((a, b) => (a.publicKey > b.publicKey ? 1 : b.publicKey > a.publicKey ? -1 : 0))

    const syncedNodesKey =
      blockchain +
      '-' +
      crypto
        .createHash('sha256')
        .update(JSON.stringify(sortedNodes, (k, v) => (k != 'publicKey' ? v : undefined)))
        .digest('hex')
    const syncedNodesCached = await this.redis.get(syncedNodesKey)

    if (syncedNodesCached) {
      syncedNodesList = JSON.parse(syncedNodesCached)
      for (const node of nodes) {
        if (syncedNodesList.includes(node.publicKey)) {
          syncedNodes.push(node)
        }
      }
      // logger.log('info', 'SYNC CHECK CACHE: ' + syncedNodes.length + ' nodes returned');
      return syncedNodes
    }

    // Cache is stale, start a new cache fill
    // First check cache lock key; if lock key exists, return full node set
    const syncLock = await this.redis.get('lock-' + syncedNodesKey)
    if (syncLock) {
      return nodes
    } else {
      // Set lock as this thread checks the sync with 60 second ttl.
      // If any major errors happen below, it will retry the sync check every 60 seconds.
      await this.redis.set('lock-' + syncedNodesKey, 'true', 'EX', 60)
    }

    // Fires all 5 sync checks synchronously then assembles the results
    const nodeSyncLogs = await this.getNodeSyncLogs(
      nodes,
      requestID,
      syncCheck,
      syncCheckPath,
      blockchain,
      applicationID,
      applicationPublicKey,
      pocket,
      pocketAAT,
      pocketConfiguration
    )

    let errorState = false

    // This should never happen
    if (nodeSyncLogs.length <= 2) {
      logger.log('error', 'SYNC CHECK ERROR: fewer than 3 nodes returned sync', {
        requestID: requestID,
        relayType: '',
        typeID: '',
        serviceNode: '',
        error: '',
        elapsedTime: '',
      })
      errorState = true
    }

    let currentBlockHeight = 0

    // Sort NodeSyncLogs by blockHeight
    nodeSyncLogs.sort((a, b) => b.blockHeight - a.blockHeight)

    // If top node is still 0, or not a number, return all nodes due to check failure
    if (
      nodeSyncLogs.length === 0 ||
      nodeSyncLogs[0].blockHeight === 0 ||
      typeof nodeSyncLogs[0].blockHeight !== 'number' ||
      nodeSyncLogs[0].blockHeight % 1 !== 0
    ) {
      logger.log('error', 'SYNC CHECK ERROR: top synced node result is invalid ' + JSON.stringify(nodeSyncLogs), {
        requestID: requestID,
        relayType: '',
        typeID: '',
        serviceNode: '',
        error: '',
        elapsedTime: '',
      })
      errorState = true
    } else {
      currentBlockHeight = nodeSyncLogs[0].blockHeight
    }

    // Make sure at least 2 nodes agree on current highest block to prevent one node from being wildly off
    if (!errorState && nodeSyncLogs[0].blockHeight > nodeSyncLogs[1].blockHeight + syncAllowance) {
      logger.log('error', 'SYNC CHECK ERROR: two highest nodes could not agree on sync', {
        requestID: requestID,
        relayType: '',
        typeID: '',
        serviceNode: '',
        error: '',
        elapsedTime: '',
      })
      errorState = true
    }

    if (errorState) {
      // Consult Altruist for sync source of truth
      currentBlockHeight = await this.getSyncFromAltruist(syncCheck, syncCheckPath, blockchainSyncBackup)

      if (currentBlockHeight === 0) {
        // Failure to find sync from consensus and altruist
        logger.log('info', 'SYNC CHECK ALTRUIST FAILURE: ' + currentBlockHeight, {
          requestID: requestID,
          relayType: '',
          typeID: '',
          serviceNode: 'ALTRUIST',
          error: '',
          elapsedTime: '',
        })
        return nodes
      } else {
        logger.log('info', 'SYNC CHECK ALTRUIST CHECK: ' + currentBlockHeight, {
          requestID: requestID,
          relayType: '',
          typeID: '',
          serviceNode: 'ALTRUIST',
          error: '',
          elapsedTime: '',
        })
      }
    }

    // Go through nodes and add all nodes that are current or within 1 block -- this allows for block processing times
    for (const nodeSyncLog of nodeSyncLogs) {
      let relayStart = process.hrtime()

      if (nodeSyncLog.blockHeight + syncAllowance >= currentBlockHeight) {
        logger.log(
          'info',
          'SYNC CHECK IN-SYNC: ' + nodeSyncLog.node.publicKey + ' height: ' + nodeSyncLog.blockHeight,
          {
            requestID: requestID,
            relayType: '',
            typeID: '',
            serviceNode: nodeSyncLog.node.publicKey,
            error: '',
            elapsedTime: '',
          }
        )

        // Erase failure mark
        await this.redis.set(
          blockchain + '-' + nodeSyncLog.node.publicKey + '-failure',
          'false',
          'EX',
          60 * 60 * 24 * 30
        )

        // In-sync: add to nodes list
        syncedNodes.push(nodeSyncLog.node)
        syncedNodesList.push(nodeSyncLog.node.publicKey)
      } else {
        logger.log('info', 'SYNC CHECK BEHIND: ' + nodeSyncLog.node.publicKey + ' height: ' + nodeSyncLog.blockHeight, {
          requestID: requestID,
          relayType: '',
          typeID: '',
          serviceNode: nodeSyncLog.node.publicKey,
          error: '',
          elapsedTime: '',
        })

        await this.metricsRecorder.recordMetric({
          requestID: requestID,
          applicationID: applicationID,
          appPubKey: applicationPublicKey,
          blockchain,
          serviceNode: nodeSyncLog.node.publicKey,
          relayStart,
          result: 500,
          bytes: Buffer.byteLength('OUT OF SYNC', 'utf8'),
          delivered: false,
          fallback: false,
          method: 'synccheck',
          error: 'OUT OF SYNC',
        })
      }
    }

    logger.log('info', 'SYNC CHECK COMPLETE: ' + syncedNodes.length + ' nodes in sync', {
      requestID: requestID,
      relayType: '',
      typeID: '',
      serviceNode: '',
      error: '',
      elapsedTime: '',
    })
    await this.redis.set(
      syncedNodesKey,
      JSON.stringify(syncedNodesList),
      'EX',
      syncedNodes.length > 0 ? 300 : 30 // will retry sync check every 30 seconds if no nodes are in sync
    )

    // If one or more nodes of this session are not in sync, fire a consensus relay with the same check.
    // This will penalize the out-of-sync nodes and cause them to get slashed for reporting incorrect data.
    if (syncedNodes.length < 5) {
      const consensusResponse = await pocket.sendRelay(
        syncCheck,
        blockchain,
        pocketAAT,
        this.updateConfigurationConsensus(pocketConfiguration),
        undefined,
        'POST' as HTTPMethod,
        undefined,
        undefined,
        true,
        'synccheck'
      )
      logger.log('info', 'SYNC CHECK CHALLENGE: ' + JSON.stringify(consensusResponse), {
        requestID: requestID,
        relayType: '',
        typeID: '',
        serviceNode: '',
        error: '',
        elapsedTime: '',
      })
    }
    return syncedNodes
  }

  async getSyncFromAltruist(syncCheck: string, syncCheckPath: string, blockchainSyncBackup: string): Promise<number> {
    // Remove user/pass from the altruist URL
    const redactedAltruistURL = blockchainSyncBackup.replace(/[\w]*:\/\/[^\/]*@/g, '')

    try {
      const syncResponse = await axios({
        method: 'POST',
        url: `${blockchainSyncBackup}${syncCheckPath}`,
        data: syncCheck,
        headers: { 'Content-Type': 'application/json' },
      })

      if (!(syncResponse instanceof Error)) {
        // Pull the blockHeight from payload.result for all chains except Pocket; this
        // can go in the database if we have more than two
        return syncResponse.data.result ? parseInt(syncResponse.data.result, 16) : syncResponse.data.height
      }
      return 0
    } catch (e) {
      logger.log('error', e.message, {
        requestID: '',
        relayType: 'FALLBACK',
        typeID: '',
        serviceNode: 'fallback:' + redactedAltruistURL,
      })
    }
    return 0
  }

  async getNodeSyncLogs(
    nodes: Node[],
    requestID: string,
    syncCheck: string,
    syncCheckPath: string,
    blockchain: string,
    applicationID: string,
    applicationPublicKey: string,
    pocket: Pocket,
    pocketAAT: PocketAAT,
    pocketConfiguration: Configuration
  ): Promise<NodeSyncLog[]> {
    const nodeSyncLogs: NodeSyncLog[] = []
    const promiseStack: Promise<NodeSyncLog>[] = []

    // Set to junk values first so that the Promise stack can fill them later
    let rawNodeSyncLogs: any[] = [0, 0, 0, 0, 0]

    for (const node of nodes) {
      promiseStack.push(
        this.getNodeSyncLog(
          node,
          requestID,
          syncCheck,
          syncCheckPath,
          blockchain,
          applicationID,
          applicationPublicKey,
          pocket,
          pocketAAT,
          pocketConfiguration
        )
      )
    }

    ;[
      rawNodeSyncLogs[0],
      rawNodeSyncLogs[1],
      rawNodeSyncLogs[2],
      rawNodeSyncLogs[3],
      rawNodeSyncLogs[4],
    ] = await Promise.all(promiseStack)

    for (const rawNodeSyncLog of rawNodeSyncLogs) {
      if (typeof rawNodeSyncLog === 'object' && rawNodeSyncLog.blockHeight > 0) {
        nodeSyncLogs.push(rawNodeSyncLog)
      }
    }
    return nodeSyncLogs
  }

  async getNodeSyncLog(
    node: Node,
    requestID: string,
    syncCheck: string,
    syncCheckPath: string,
    blockchain: string,
    applicationID: string,
    applicationPublicKey: string,
    pocket: Pocket,
    pocketAAT: PocketAAT,
    pocketConfiguration: Configuration
  ): Promise<NodeSyncLog> {
    logger.log('info', 'SYNC CHECK START', {
      requestID: requestID,
      relayType: '',
      typeID: '',
      serviceNode: node.publicKey,
      error: '',
      elapsedTime: '',
    })

    // Pull the current block from each node using the blockchain's syncCheck as the relay
    let relayStart = process.hrtime()

    const relayResponse = await pocket.sendRelay(
      syncCheck,
      blockchain,
      pocketAAT,
      this.updateConfigurationTimeout(pocketConfiguration),
      undefined,
      'POST' as HTTPMethod,
      syncCheckPath,
      node,
      false,
      'synccheck'
    )

    if (relayResponse instanceof RelayResponse && checkEnforcementJSON(relayResponse.payload)) {
      const payload = JSON.parse(relayResponse.payload)

      // Pull the blockHeight from payload.result for all chains except Pocket; this
      // can go in the database if we have more than two
      const blockHeight = payload.result ? parseInt(payload.result, 16) : payload.height

      // Create a NodeSyncLog for each node with current block
      const nodeSyncLog = {
        node: node,
        blockchain: blockchain,
        blockHeight,
      } as NodeSyncLog
      logger.log('info', 'SYNC CHECK RESULT: ' + JSON.stringify(nodeSyncLog), {
        requestID: requestID,
        relayType: '',
        typeID: '',
        serviceNode: node.publicKey,
        error: '',
        elapsedTime: '',
      })

      // Success
      return nodeSyncLog
    } else if (relayResponse instanceof Error) {
      logger.log('error', 'SYNC CHECK ERROR: ' + JSON.stringify(relayResponse), {
        requestID: requestID,
        relayType: '',
        typeID: '',
        serviceNode: node.publicKey,
        error: '',
        elapsedTime: '',
      })

      let error = relayResponse.message
      if (typeof relayResponse.message === 'object') {
        error = JSON.stringify(relayResponse.message)
      }

      if (error !== 'Provided Node is not part of the current session for this application, check your PocketAAT') {
        await this.metricsRecorder.recordMetric({
          requestID: requestID,
          applicationID: applicationID,
          appPubKey: applicationPublicKey,
          blockchain,
          serviceNode: node.publicKey,
          relayStart,
          result: 500,
          bytes: Buffer.byteLength(relayResponse.message, 'utf8'),
          delivered: false,
          fallback: false,
          method: 'synccheck',
          error,
        })
      }
    } else {
      logger.log('error', 'SYNC CHECK ERROR UNHANDLED: ' + JSON.stringify(relayResponse), {
        requestID: requestID,
        relayType: '',
        typeID: '',
        serviceNode: node.publicKey,
        error: '',
        elapsedTime: '',
      })
    }
    // Failed
    const nodeSyncLog = {
      node: node,
      blockchain: blockchain,
      blockHeight: 0,
    } as NodeSyncLog
    return nodeSyncLog
  }

  updateConfigurationConsensus(pocketConfiguration: Configuration) {
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

  updateConfigurationTimeout(pocketConfiguration: Configuration) {
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

type NodeSyncLog = {
  node: Node
  blockchain: string
  blockHeight: number
}

export type ConsensusFilterOptions = {
  nodes: Node[]
  requestID: string
  syncCheck: string
  syncCheckPath: string
  syncAllowance: number
  blockchain: string
  blockchainSyncBackup: string
  applicationID: string
  applicationPublicKey: string
  pocket: Pocket
  pocketAAT: PocketAAT
  pocketConfiguration: Configuration
}
