import axios from 'axios'
import { Redis } from 'ioredis'
import { Configuration, HTTPMethod, Session, Node, Pocket, PocketAAT, RelayResponse } from '@pokt-network/pocket-js'
import { MetricsRecorder } from '../services/metrics-recorder'
import { blockHexToDecimal } from '../utils/block'
import { removeNodeFromSession, getNodeNetworkData } from '../utils/cache'
import { MAX_RELAYS_ERROR } from '../utils/constants'
import { checkEnforcementJSON } from '../utils/enforcements'
import { hashBlockchainNodes } from '../utils/helpers'
import { CheckResult } from '../utils/types'

const logger = require('../services/logger')

export class SyncChecker {
  redis: Redis
  metricsRecorder: MetricsRecorder
  defaultSyncAllowance: number
  origin: string

  constructor(redis: Redis, metricsRecorder: MetricsRecorder, defaultSyncAllowance: number, origin: string) {
    this.redis = redis
    this.metricsRecorder = metricsRecorder
    this.defaultSyncAllowance = defaultSyncAllowance
    this.origin = origin
  }

  async consensusFilter({
    nodes,
    requestID,
    syncCheckOptions,
    blockchainID,
    blockchainSyncBackup,
    applicationID,
    applicationPublicKey,
    pocket,
    pocketAAT,
    pocketConfiguration,
    pocketSession,
  }: ConsensusFilterOptions): Promise<CheckResult> {
    // Blockchain records passed in with 0 sync allowance are missing the 'syncAllowance' field in MongoDB
    syncCheckOptions.allowance = syncCheckOptions.allowance > 0 ? syncCheckOptions.allowance : this.defaultSyncAllowance

    const sessionHash = await hashBlockchainNodes(blockchainID, pocketSession.sessionNodes, this.redis)

    const syncedNodes: Node[] = []
    let syncedNodesList: string[] = []

    // Value is an array of node public keys that have passed sync checks for this session in the past 5 minutes
    const syncedNodesKey = `sync-check-${sessionHash}`
    const syncedNodesCached = await this.redis.get(syncedNodesKey)

    const cached = Boolean(syncedNodesCached)

    if (cached) {
      syncedNodesList = JSON.parse(syncedNodesCached)
      for (const node of nodes) {
        if (syncedNodesList.includes(node.publicKey)) {
          syncedNodes.push(node)
        }
      }
      // logger.log('info', 'SYNC CHECK CACHE: ' + syncedNodes.length + ' nodes returned');
      return { nodes: syncedNodes, cached }
    }

    // Cache is stale, start a new cache fill
    // First check cache lock key; if lock key exists, return full node set
    const syncLock = await this.redis.get('lock-' + syncedNodesKey)

    if (syncLock) {
      return { nodes, cached }
    } else {
      // Set lock as this thread checks the sync with 60 second ttl.
      // If any major errors happen below, it will retry the sync check every 60 seconds.
      await this.redis.set('lock-' + syncedNodesKey, 'true', 'EX', 60)
    }

    // Fires all 5 sync checks synchronously then assembles the results
    const nodeSyncLogs = await this.getNodeSyncLogs(
      nodes,
      requestID,
      syncCheckOptions,
      blockchainID,
      applicationID,
      applicationPublicKey,
      pocket,
      pocketAAT,
      pocketConfiguration,
      sessionHash,
      pocketSession
    )

    let errorState = false

    // This should never happen
    if (nodes.length > 2 && nodeSyncLogs.length <= 2) {
      logger.log('error', 'SYNC CHECK ERROR: fewer than 3 nodes returned sync', {
        requestID: requestID,
        relayType: '',
        blockchainID,
        typeID: '',
        serviceNode: '',
        error: '',
        elapsedTime: '',
        origin: this.origin,
        sessionHash,
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
        blockchainID,
        typeID: '',
        serviceNode: '',
        error: '',
        elapsedTime: '',
        origin: this.origin,
        sessionHash,
      })
      errorState = true
    } else {
      currentBlockHeight = nodeSyncLogs[0].blockHeight
    }

    // If there's at least 2 nodes, make sure at least two of them agree on current highest block to prevent one node
    // from being wildly off
    if (
      !errorState &&
      nodeSyncLogs.length >= 2 &&
      nodeSyncLogs[0].blockHeight > nodeSyncLogs[1].blockHeight + syncCheckOptions.allowance
    ) {
      logger.log('error', 'SYNC CHECK ERROR: two highest nodes could not agree on sync', {
        requestID: requestID,
        relayType: '',
        blockchainID,
        typeID: '',
        serviceNode: '',
        error: '',
        elapsedTime: '',
        origin: this.origin,
        sessionHash,
      })
      errorState = true
    }

    // Consult Altruist for sync source of truth
    const altruistBlockHeight = await this.getSyncFromAltruist(syncCheckOptions, blockchainSyncBackup)

    if (altruistBlockHeight === 0 || isNaN(altruistBlockHeight)) {
      // Failure to find sync from consensus and altruist
      logger.log('info', 'SYNC CHECK ALTRUIST FAILURE: ' + altruistBlockHeight, {
        requestID: requestID,
        relayType: '',
        blockchainID,
        typeID: '',
        serviceNode: 'ALTRUIST',
        error: '',
        elapsedTime: '',
        origin: this.origin,
        sessionHash,
      })

      if (errorState) {
        return { nodes, cached }
      }
    } else {
      logger.log('info', 'SYNC CHECK ALTRUIST CHECK: ' + altruistBlockHeight, {
        requestID: requestID,
        relayType: '',
        blockchainID,
        typeID: '',
        serviceNode: 'ALTRUIST',
        error: '',
        elapsedTime: '',
        origin: this.origin,
        sessionHash,
      })
    }

    // Go through nodes and add all nodes that are current or within 1 block -- this allows for block processing times
    for (const nodeSyncLog of nodeSyncLogs) {
      const relayStart = process.hrtime()
      const allowedBlockHeight = nodeSyncLog.blockHeight + syncCheckOptions.allowance

      const { serviceURL, serviceDomain } = await getNodeNetworkData(this.redis, nodeSyncLog.node.publicKey, requestID)

      if (allowedBlockHeight >= currentBlockHeight && allowedBlockHeight >= altruistBlockHeight) {
        logger.log(
          'info',
          'SYNC CHECK IN-SYNC: ' + nodeSyncLog.node.publicKey + ' height: ' + nodeSyncLog.blockHeight,
          {
            requestID: requestID,
            relayType: '',
            blockchainID,
            typeID: '',
            serviceNode: nodeSyncLog.node.publicKey,
            error: '',
            elapsedTime: '',
            origin: this.origin,
            serviceURL,
            serviceDomain,
            sessionHash,
          }
        )

        // Erase failure mark
        await this.redis.set(
          blockchainID + '-' + nodeSyncLog.node.publicKey + '-failure',
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
          blockchainID,
          typeID: '',
          serviceNode: nodeSyncLog.node.publicKey,
          error: '',
          elapsedTime: '',
          origin: this.origin,
          serviceURL,
          serviceDomain,
          sessionHash,
        })

        this.metricsRecorder
          .recordMetric({
            requestID: requestID,
            applicationID: applicationID,
            applicationPublicKey: applicationPublicKey,
            blockchainID,
            serviceNode: nodeSyncLog.node.publicKey,
            relayStart,
            result: 500,
            bytes: Buffer.byteLength('OUT OF SYNC', 'utf8'),
            fallback: false,
            method: 'synccheck',
            error: `OUT OF SYNC: current block height on chain ${blockchainID}: ${currentBlockHeight} altruist block height: ${altruistBlockHeight} nodes height: ${nodeSyncLog.blockHeight} sync allowance: ${syncCheckOptions.allowance}`,
            code: undefined,
            origin: this.origin,
            data: undefined,
            pocketSession,
          })
          .catch(function log(e) {
            logger.log('error', 'Error recording metrics: ' + e, {
              requestID: requestID,
              relayType: 'APP',
              typeID: applicationID,
              serviceNode: nodeSyncLog.node.publicKey,
            })
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
      blockchainID,
      origin: this.origin,
      sessionHash,
    })
    await this.redis.set(
      syncedNodesKey,
      JSON.stringify(syncedNodesList),
      'EX',
      syncedNodes.length > 0 ? 300 : 30 // will retry sync check every 30 seconds if no nodes are in sync
    )

    // If one or more nodes of this session are not in sync, fire a consensus relay with the same check.
    // This will penalize the out-of-sync nodes and cause them to get slashed for reporting incorrect data.
    if (syncedNodes.length < nodes.length) {
      const consensusResponse = await pocket.sendRelay(
        syncCheckOptions.body,
        blockchainID,
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
        blockchainID,
        origin: this.origin,
        sessionHash,
      })
    }
    return { nodes: syncedNodes, cached }
  }

  async getSyncFromAltruist(syncCheckOptions: SyncCheckOptions, blockchainSyncBackup: string): Promise<number> {
    // Remove user/pass from the altruist URL
    const redactedAltruistURL = blockchainSyncBackup.replace(/[\w]*:\/\/[^\/]*@/g, '')
    const syncCheckPath = syncCheckOptions.path ? syncCheckOptions.path : ''

    try {
      const syncResponse = await axios({
        method: 'POST',
        url: `${blockchainSyncBackup}${syncCheckPath}`,
        data: syncCheckOptions.body,
        headers: { 'Content-Type': 'application/json' },
      })

      if (!(syncResponse instanceof Error)) {
        const payload = syncResponse.data // object that includes 'resultKey'
        const blockHeight = this.parseBlockFromPayload(payload, syncCheckOptions.resultKey)

        return blockHeight
      }
      return 0
    } catch (e) {
      logger.log('error', e.message, {
        requestID: '',
        relayType: 'FALLBACK',
        typeID: '',
        serviceNode: 'fallback:' + redactedAltruistURL,
        error: '',
        elapsedTime: '',
        origin: this.origin,
      })
    }
    return 0
  }

  async getNodeSyncLogs(
    nodes: Node[],
    requestID: string,
    syncCheckOptions: SyncCheckOptions,
    blockchainID: string,
    applicationID: string,
    applicationPublicKey: string,
    pocket: Pocket,
    pocketAAT: PocketAAT,
    pocketConfiguration: Configuration,
    sessionHash: string,
    pocketSession: Session
  ): Promise<NodeSyncLog[]> {
    const nodeSyncLogs: NodeSyncLog[] = []
    const promiseStack: Promise<NodeSyncLog>[] = []

    // Set to junk values first so that the Promise stack can fill them later
    const rawNodeSyncLogs: NodeSyncLog[] = [
      <NodeSyncLog>{},
      <NodeSyncLog>{},
      <NodeSyncLog>{},
      <NodeSyncLog>{},
      <NodeSyncLog>{},
    ]

    for (const node of nodes) {
      promiseStack.push(
        this.getNodeSyncLog(
          node,
          requestID,
          syncCheckOptions,
          blockchainID,
          applicationID,
          applicationPublicKey,
          pocket,
          pocketAAT,
          pocketConfiguration,
          sessionHash,
          pocketSession
        )
      )
    }

    ;[
      rawNodeSyncLogs[0],
      rawNodeSyncLogs[1],
      rawNodeSyncLogs[2],
      rawNodeSyncLogs[3],
      rawNodeSyncLogs[4],
      rawNodeSyncLogs[5],
      rawNodeSyncLogs[6],
      rawNodeSyncLogs[7],
    ] = await Promise.all(promiseStack)

    for (const rawNodeSyncLog of rawNodeSyncLogs) {
      if (typeof rawNodeSyncLog === 'object' && rawNodeSyncLog?.blockHeight > 0) {
        nodeSyncLogs.push(rawNodeSyncLog)
      }
    }
    return nodeSyncLogs
  }

  async getNodeSyncLog(
    node: Node,
    requestID: string,
    syncCheckOptions: SyncCheckOptions,
    blockchainID: string,
    applicationID: string,
    applicationPublicKey: string,
    pocket: Pocket,
    pocketAAT: PocketAAT,
    pocketConfiguration: Configuration,
    sessionHash: string,
    pocketSession?: Session
  ): Promise<NodeSyncLog> {
    const { sessionNodes } = pocketSession || {}
    // Pull the current block from each node using the blockchain's syncCheck as the relay
    const relayStart = process.hrtime()

    const relayResponse = await pocket.sendRelay(
      syncCheckOptions.body,
      blockchainID,
      pocketAAT,
      this.updateConfigurationTimeout(pocketConfiguration),
      undefined,
      'POST' as HTTPMethod,
      syncCheckOptions.path,
      node,
      false,
      'synccheck'
    )

    const { serviceURL, serviceDomain } = await getNodeNetworkData(this.redis, node.publicKey, requestID)

    if (relayResponse instanceof RelayResponse && checkEnforcementJSON(relayResponse.payload)) {
      const payload = JSON.parse(relayResponse.payload) // object that may not include 'resultKey'

      const blockHeight = this.parseBlockFromPayload(payload, syncCheckOptions.resultKey)

      // Create a NodeSyncLog for each node with current block
      const nodeSyncLog = {
        node: node,
        blockchainID,
        blockHeight,
      } as NodeSyncLog

      logger.log('info', 'SYNC CHECK RESULT: ' + JSON.stringify(nodeSyncLog), {
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
        sessionHash,
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
        blockchainID,
        origin: this.origin,
        serviceURL,
        serviceDomain,
        sessionHash,
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
          bytes: Buffer.byteLength(relayResponse.message, 'utf8'),
          fallback: false,
          method: 'synccheck',
          error,
          code: undefined,
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
      logger.log('error', 'SYNC CHECK ERROR UNHANDLED: ' + JSON.stringify(relayResponse), {
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
        sessionHash,
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
          bytes: Buffer.byteLength('SYNC CHECK', 'utf8'),
          fallback: false,
          method: 'synccheck',
          error: JSON.stringify(relayResponse),
          code: undefined,
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
    const nodeSyncLog = {
      node: node,
      blockchainID,
      blockHeight: 0,
    } as NodeSyncLog

    return nodeSyncLog
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

  // TODO: We might want to support result keys in nested objects
  parseBlockFromPayload(payload: object, syncCheckResultKey: string): number {
    const rawHeight = payload[`${syncCheckResultKey}`] || '0'

    const blockHeight = blockHexToDecimal(rawHeight)

    return blockHeight
  }
}

type NodeSyncLog = {
  node: Node
  blockchainID: string
  blockHeight: number
}

export interface SyncCheckOptions {
  path?: string
  body: string
  resultKey: string
  allowance?: number
}

export type ConsensusFilterOptions = {
  nodes: Node[]
  requestID: string
  syncCheckOptions: SyncCheckOptions
  blockchainID: string
  blockchainSyncBackup: string
  applicationID: string
  applicationPublicKey: string
  pocket: Pocket
  pocketAAT: PocketAAT
  pocketConfiguration: Configuration
  pocketSession: Session
}
