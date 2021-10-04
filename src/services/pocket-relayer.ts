import { CherryPicker } from '../services/cherry-picker'
import { MetricsRecorder } from '../services/metrics-recorder'
import { ConsensusFilterOptions, SyncChecker, SyncCheckOptions } from '../services/sync-checker'
import { ChainChecker, ChainIDFilterOptions } from '../services/chain-checker'
import { Decryptor } from 'strong-cryptor'
import { HttpErrors } from '@loopback/rest'
import { PocketAAT, Session, RelayResponse, Pocket, Configuration, HTTPMethod, Node } from '@pokt-network/pocket-js'
import { Redis } from 'ioredis'
import { BlockchainsRepository } from '../repositories'
import { Applications } from '../models'
import { RelayError, LimitError, MAX_RELAYS_ERROR } from '../errors/types'
import AatPlans from '../config/aat-plans.json'
import { blockHexToDecimal, checkEnforcementJSON } from '../utils'

import { JSONObject } from '@loopback/context'

const logger = require('../services/logger')

import axios from 'axios'
import { removeNodeFromSession } from '../utils/cache'

const WS_ONLY_METHODS = [
  'eth_subscribe',
  'eth_newFilter',
  'newBlockFilter',
  'eth_getFilterChanges',
  'eth_getFilterLogs',
]

export class PocketRelayer {
  host: string
  origin: string
  userAgent: string
  pocket: Pocket
  pocketConfiguration: Configuration
  cherryPicker: CherryPicker
  metricsRecorder: MetricsRecorder
  syncChecker: SyncChecker
  chainChecker: ChainChecker
  redis: Redis
  databaseEncryptionKey: string
  secretKey: string
  relayRetries: number
  blockchainsRepository: BlockchainsRepository
  checkDebug: boolean
  altruists: JSONObject
  aatPlan: string
  defaultLogLimitBlocks: number

  constructor({
    host,
    origin,
    userAgent,
    pocket,
    pocketConfiguration,
    cherryPicker,
    metricsRecorder,
    syncChecker,
    chainChecker,
    redis,
    databaseEncryptionKey,
    secretKey,
    relayRetries,
    blockchainsRepository,
    checkDebug,
    altruists,
    aatPlan,
    defaultLogLimitBlocks,
  }: {
    host: string
    origin: string
    userAgent: string
    pocket: Pocket
    pocketConfiguration: Configuration
    cherryPicker: CherryPicker
    metricsRecorder: MetricsRecorder
    syncChecker: SyncChecker
    chainChecker: ChainChecker
    redis: Redis
    databaseEncryptionKey: string
    secretKey: string
    relayRetries: number
    blockchainsRepository: BlockchainsRepository
    checkDebug: boolean
    altruists: string
    aatPlan: string
    defaultLogLimitBlocks: number
  }) {
    this.host = host
    this.origin = origin
    this.userAgent = userAgent
    this.pocket = pocket
    this.pocketConfiguration = pocketConfiguration
    this.cherryPicker = cherryPicker
    this.metricsRecorder = metricsRecorder
    this.syncChecker = syncChecker
    this.chainChecker = chainChecker
    this.redis = redis
    this.databaseEncryptionKey = databaseEncryptionKey
    this.secretKey = secretKey
    this.relayRetries = relayRetries
    this.blockchainsRepository = blockchainsRepository
    this.checkDebug = checkDebug
    this.aatPlan = aatPlan
    this.defaultLogLimitBlocks = defaultLogLimitBlocks

    // Create the array of altruist relayers as last resort
    this.altruists = JSON.parse(altruists)
  }

  async sendRelay({
    rawData,
    relayPath,
    httpMethod,
    application,
    requestID,
    requestTimeOut,
    overallTimeOut,
    relayRetries,
    logLimitBlocks,
  }: SendRelayOptions): Promise<string | Error> {
    if (relayRetries !== undefined && relayRetries >= 0) {
      this.relayRetries = relayRetries
    }
    const {
      blockchain,
      blockchainEnforceResult,
      blockchainSyncCheck,
      blockchainIDCheck,
      blockchainID,
      blockchainChainID,
      blockchainLogLimitBlocks,
    } = await this.loadBlockchain()
    const overallStart = process.hrtime()

    // Check for lb-specific log limits
    if (logLimitBlocks === undefined || logLimitBlocks <= 0) {
      logLimitBlocks = blockchainLogLimitBlocks
    }

    // This converts the raw data into formatted JSON then back to a string for relaying.
    // This allows us to take in both [{},{}] arrays of JSON and plain JSON and removes
    // extraneous characters like newlines and tabs from the rawData.
    // Normally the arrays of JSON do not pass the AJV validation used by Loopback.

    const parsedRawData = Object.keys(rawData).length > 0 ? JSON.parse(rawData.toString()) : JSON.stringify(rawData)
    const limitation = await this.enforceLimits(parsedRawData, blockchainID, logLimitBlocks)

    if (limitation instanceof Error) {
      logger.log('error', `${parsedRawData.method} method limitations exceeded.`, {
        requestID: requestID,
        relayType: 'APP',
        typeID: application.id,
        serviceNode: '',
      })
      return limitation
    }
    const data = JSON.stringify(parsedRawData)
    const method = this.parseMethod(parsedRawData)
    const fallbackAvailable = this.altruists[blockchainID] !== undefined ? true : false

    // Retries if applicable
    for (let x = 0; x <= this.relayRetries; x++) {
      const relayStart = process.hrtime()

      // Compute the overall time taken on this LB request
      const overallCurrent = process.hrtime(overallStart)
      const overallCurrentElasped = Math.round((overallCurrent[0] * 1e9 + overallCurrent[1]) / 1e6)

      if (overallTimeOut && overallCurrentElasped > overallTimeOut) {
        logger.log('error', 'Overall Timeout exceeded: ' + overallTimeOut, {
          requestID: requestID,
          relayType: 'APP',
          typeID: application.id,
          serviceNode: '',
        })
        return new HttpErrors.GatewayTimeout('Overall Timeout exceeded: ' + overallTimeOut)
      }

      // Send this relay attempt
      const relayResponse = await this._sendRelay({
        data,
        relayPath,
        httpMethod,
        requestID,
        application,
        requestTimeOut,
        blockchain,
        blockchainID,
        blockchainEnforceResult,
        blockchainSyncCheck,
        blockchainIDCheck,
        blockchainChainID,
        blockchainSyncBackup: String(this.altruists[blockchainID]),
      })

      if (!(relayResponse instanceof Error)) {
        // Record success metric
        await this.metricsRecorder.recordMetric({
          requestID: requestID,
          applicationID: application.id,
          applicationPublicKey: application.gatewayAAT.applicationPublicKey,
          blockchainID,
          serviceNode: relayResponse.proof.servicerPubKey,
          relayStart,
          result: 200,
          bytes: Buffer.byteLength(relayResponse.payload, 'utf8'),
          delivered: false,
          fallback: false,
          method: method,
          error: undefined,
          origin: this.origin,
          data,
        })

        // Clear error log
        await this.redis.del(blockchainID + '-' + relayResponse.proof.servicerPubKey + '-errors')

        // If return payload is valid JSON, turn it into an object so it is sent with content-type: json
        if (
          blockchainEnforceResult && // Is this blockchain marked for result enforcement // and
          blockchainEnforceResult.toLowerCase() === 'json' // the check is for JSON
        ) {
          return JSON.parse(relayResponse.payload)
        }
        return relayResponse.payload
      } else if (relayResponse instanceof RelayError) {
        // Record failure metric, retry if possible or fallback
        // If this is the last retry and fallback is available, mark the error not delivered
        const errorDelivered = x === this.relayRetries && fallbackAvailable ? false : true

        // Increment error log
        await this.redis.incr(blockchainID + '-' + relayResponse.servicer_node + '-errors')
        await this.redis.expire(blockchainID + '-' + relayResponse.servicer_node + '-errors', 3600)

        let error = relayResponse.message

        if (typeof relayResponse.message === 'object') {
          error = JSON.stringify(relayResponse.message)
        }

        await this.metricsRecorder.recordMetric({
          requestID,
          applicationID: application.id,
          applicationPublicKey: application.gatewayAAT.applicationPublicKey,
          blockchainID,
          serviceNode: relayResponse.servicer_node,
          relayStart,
          result: 500,
          bytes: Buffer.byteLength(relayResponse.message, 'utf8'),
          delivered: errorDelivered,
          fallback: false,
          method,
          error,
          origin: this.origin,
          data,
        })
      }
    }

    // Exhausted network relay attempts; use fallback
    if (fallbackAvailable) {
      const relayStart = process.hrtime()
      let axiosConfig = {}

      // Add relay path to URL
      const altruistURL =
        relayPath === undefined || relayPath === ''
          ? this.altruists[blockchainID]
          : `${this.altruists[blockchainID]}${relayPath}`

      // Remove user/pass from the altruist URL
      const redactedAltruistURL = String(this.altruists[blockchainID])?.replace(/[\w]*:\/\/[^\/]*@/g, '')

      if (httpMethod === 'POST') {
        axiosConfig = {
          method: 'POST',
          url: altruistURL,
          data: rawData.toString(),
          headers: { 'Content-Type': 'application/json' },
        }
      } else {
        axiosConfig = {
          method: httpMethod,
          url: altruistURL,
          data: rawData.toString(),
        }
      }
      try {
        const fallbackResponse = await axios(axiosConfig)

        if (this.checkDebug) {
          logger.log('debug', JSON.stringify(fallbackResponse.data), {
            requestID: requestID,
            relayType: 'FALLBACK',
            typeID: application.id,
            serviceNode: 'fallback:' + redactedAltruistURL,
            error: '',
            elapsedTime: '',
            blockchainID: '',
            origin: this.origin,
          })
        }

        if (!(fallbackResponse instanceof Error)) {
          const responseParsed = JSON.stringify(fallbackResponse.data)

          await this.metricsRecorder.recordMetric({
            requestID: requestID,
            applicationID: application.id,
            applicationPublicKey: application.gatewayAAT.applicationPublicKey,
            blockchainID,
            serviceNode: 'fallback:' + redactedAltruistURL,
            relayStart,
            result: 200,
            bytes: Buffer.byteLength(responseParsed, 'utf8'),
            delivered: false,
            fallback: true,
            method: method,
            error: undefined,
            origin: this.origin,
            data,
          })

          // If return payload is valid JSON, turn it into an object so it is sent with content-type: json
          if (
            blockchainEnforceResult && // Is this blockchain marked for result enforcement and
            blockchainEnforceResult.toLowerCase() === 'json' && // the check is for JSON
            typeof responseParsed === 'string' &&
            (responseParsed.match('{') || responseParsed.match(/'\[{'/g)) // and it matches JSON
          ) {
            return JSON.parse(responseParsed)
          }

          return responseParsed
        } else {
          logger.log('error', JSON.stringify(fallbackResponse), {
            requestID: requestID,
            relayType: 'FALLBACK',
            typeID: application.id,
            serviceNode: 'fallback:' + redactedAltruistURL,
            blockchainID,
            origin: this.origin,
          })
        }
      } catch (e) {
        logger.log('error', e.message, {
          requestID: requestID,
          relayType: 'FALLBACK',
          typeID: application.id,
          serviceNode: 'fallback:' + redactedAltruistURL,
          blockchainID,
          origin: this.origin,
        })
      }
    }
    return new HttpErrors.GatewayTimeout('Relay attempts exhausted')
  }

  // Private function to allow relay retries
  async _sendRelay({
    data,
    relayPath,
    httpMethod,
    requestID,
    application,
    requestTimeOut,
    blockchain,
    blockchainEnforceResult,
    blockchainSyncCheck,
    blockchainSyncBackup,
    blockchainIDCheck,
    blockchainID,
    blockchainChainID,
  }: {
    data: string
    relayPath: string
    httpMethod: HTTPMethod
    requestID: string
    application: Applications
    requestTimeOut: number | undefined
    blockchain: string
    blockchainEnforceResult: string
    blockchainSyncCheck: SyncCheckOptions
    blockchainSyncBackup: string
    blockchainIDCheck: string
    blockchainID: string
    blockchainChainID: string
  }): Promise<RelayResponse | Error> {
    // Secret key check
    if (!this.checkSecretKey(application)) {
      throw new HttpErrors.Forbidden('SecretKey does not match')
    }

    // Whitelist: origins -- explicit matches
    if (!this.checkWhitelist(application.gatewaySettings.whitelistOrigins, this.origin, 'explicit')) {
      throw new HttpErrors.Forbidden('Whitelist Origin check failed: ' + this.origin)
    }

    // Whitelist: userAgent -- substring matches
    if (!this.checkWhitelist(application.gatewaySettings.whitelistUserAgents, this.userAgent, 'substring')) {
      throw new HttpErrors.Forbidden('Whitelist User Agent check failed: ' + this.userAgent)
    }

    const aatParams: [string, string, string, string] =
      this.aatPlan === AatPlans.FREEMIUM
        ? [
            application.gatewayAAT.version,
            application.freeTierAAT.clientPublicKey,
            application.freeTierAAT.applicationPublicKey,
            application.freeTierAAT.applicationSignature,
          ]
        : [
            application.gatewayAAT.version,
            application.gatewayAAT.clientPublicKey,
            application.gatewayAAT.applicationPublicKey,
            application.gatewayAAT.applicationSignature,
          ]

    // Checks pass; create AAT
    const pocketAAT = new PocketAAT(...aatParams)

    let node: Node

    // Pull the session so we can get a list of nodes and cherry pick which one to use
    const pocketSession = await this.pocket.sessionManager.getCurrentSession(
      pocketAAT,
      blockchainID,
      this.pocketConfiguration
    )

    if (pocketSession instanceof Session) {
      const { sessionKey } = pocketSession
      const sessionCacheKey = `session-${sessionKey}`

      let syncCheckPromise: Promise<Node[]>
      let syncCheckedNodes: Node[]

      let chainCheckPromise: Promise<Node[]>
      let chainCheckedNodes: Node[]

      let nodes: Node[] = pocketSession.sessionNodes
      const relayStart = process.hrtime()

      const nodesToRemove = await this.redis.smembers(sessionCacheKey)

      if (nodesToRemove.length > 0) {
        nodes = nodes.filter((n) => !nodesToRemove.includes(n.publicKey))
      } else {
        // Adds and removes dummy value as you cannot set EXPIRE on empty redis set
        await this.redis.sadd(sessionCacheKey, '0')
        await this.redis.expire(sessionCacheKey, 60 * 60 * 2) // 2 Hours
        await this.redis.spop(sessionCacheKey)
      }

      if (nodes.length === 0) {
        logger.log('warn', `SESSION: ${sessionKey} has exhausted all node relays`, {
          requestID: requestID,
          relayType: 'APP',
          typeID: application.id,
          serviceNode: '',
        })
        return new Error("session doesn't have any available nodes")
      }

      if (blockchainIDCheck) {
        // Check Chain ID
        const chainIDOptions: ChainIDFilterOptions = {
          nodes,
          requestID,
          blockchainID,
          pocketAAT,
          applicationID: application.id,
          applicationPublicKey: application.gatewayAAT.applicationPublicKey,
          chainCheck: blockchainIDCheck,
          chainID: parseInt(blockchainChainID),
          pocket: this.pocket,
          pocketConfiguration: this.pocketConfiguration,
          sessionKey: pocketSession.sessionKey,
        }

        chainCheckPromise = this.chainChecker.chainIDFilter(chainIDOptions)
      }

      if (blockchainSyncCheck) {
        // Check Sync
        const consensusFilterOptions: ConsensusFilterOptions = {
          nodes,
          requestID,
          syncCheck: blockchainSyncCheck,
          blockchainID,
          blockchainSyncBackup,
          applicationID: application.id,
          applicationPublicKey: application.gatewayAAT.applicationPublicKey,
          pocket: this.pocket,
          pocketAAT,
          pocketConfiguration: this.pocketConfiguration,
          sessionKey: pocketSession.sessionKey,
        }

        syncCheckPromise = this.syncChecker.consensusFilter(consensusFilterOptions)
      }

      const checkersPromise = Promise.allSettled([chainCheckPromise, syncCheckPromise])

      const [chainCheckResult, syncCheckResult] = await checkersPromise

      if (blockchainIDCheck) {
        if (
          chainCheckResult.status === 'fulfilled' &&
          chainCheckResult.value !== undefined &&
          chainCheckResult.value.length > 0
        ) {
          chainCheckedNodes = chainCheckResult.value
        } else {
          if (chainCheckResult.status === 'rejected') {
            logger.log('error', `Error while running chain check: ${chainCheckResult.reason}.`, {
              requestID: requestID,
              relayType: 'APP',
              typeID: application.id,
              serviceNode: '',
            })
          }
          return new Error('ChainID check failure; using fallbacks')
        }
      }

      if (blockchainSyncCheck) {
        if (
          syncCheckResult.status === 'fulfilled' &&
          syncCheckResult.value !== undefined &&
          syncCheckResult.value.length > 0
        ) {
          syncCheckedNodes = syncCheckResult.value
        } else {
          const error = 'Sync / chain check failure'
          const method = 'checks'

          await this.metricsRecorder.recordMetric({
            requestID,
            applicationID: application.id,
            applicationPublicKey: application.gatewayAAT.applicationPublicKey,
            blockchainID,
            serviceNode: 'session-failure',
            relayStart,
            result: 500,
            bytes: Buffer.byteLength(error, 'utf8'),
            delivered: false,
            fallback: false,
            method,
            error,
            origin: this.origin,
            data,
          })

          if (syncCheckResult.status === 'rejected') {
            logger.log('error', `Error while running sync check: ${syncCheckResult.reason}.`, {
              requestID: requestID,
              relayType: 'APP',
              typeID: application.id,
              serviceNode: '',
            })
          }

          return new Error('Sync / chain check failure; using fallbacks')
        }
      }

      // EVM-chains always have chain/sync checks.
      if (blockchainIDCheck && blockchainSyncCheck) {
        nodes = this.filterCheckedNodes(syncCheckedNodes, chainCheckedNodes)
      } else if (blockchainSyncCheck) {
        // For non-EVM chains that only have sync check, like pocket.
        nodes = syncCheckedNodes
      }

      node = await this.cherryPicker.cherryPickNode(application, nodes, blockchainID, requestID)
    }

    if (this.checkDebug) {
      logger.log('debug', JSON.stringify(pocketSession), {
        requestID: requestID,
        relayType: 'APP',
        typeID: application.id,
        serviceNode: node?.publicKey,
      })
    }

    // Adjust Pocket Configuration for a custom requestTimeOut
    let relayConfiguration = this.pocketConfiguration

    if (requestTimeOut) {
      relayConfiguration = this.updateConfiguration(requestTimeOut)
    }

    // Send relay and process return: RelayResponse, RpcError, ConsensusNode, or undefined
    const relayResponse = await this.pocket.sendRelay(
      data,
      blockchainID,
      pocketAAT,
      relayConfiguration,
      undefined,
      httpMethod,
      relayPath,
      node,
      undefined,
      requestID
    )

    if (this.checkDebug) {
      logger.log('debug', JSON.stringify(relayConfiguration), {
        requestID: requestID,
        relayType: 'APP',
        typeID: application.id,
        serviceNode: node?.publicKey,
      })
      logger.log('debug', JSON.stringify(relayResponse), {
        requestID: requestID,
        relayType: 'APP',
        typeID: application.id,
        serviceNode: node?.publicKey,
      })
    }

    // Success
    if (relayResponse instanceof RelayResponse) {
      // First, check for the format of the result; Pocket Nodes will return relays that include
      // erroneous results like "invalid host specified" when the node is configured incorrectly.
      // Those results are still marked as 200:success.
      // To filter them out, we will enforce result formats on certain blockchains. If the
      // relay result is not in the correct format, this was not a successful relay.
      if (
        blockchainEnforceResult && // Is this blockchain marked for result enforcement // and
        blockchainEnforceResult.toLowerCase() === 'json' && // the check is for JSON // and
        (!checkEnforcementJSON(relayResponse.payload) || // the relay response is not valid JSON // or
          relayResponse.payload.startsWith('{"error"')) // the full payload is an error
      ) {
        // then this result is invalid
        return new RelayError(relayResponse.payload, 503, relayResponse.proof.servicerPubKey)
      } else {
        // Success
        return relayResponse
      }
      // Error
    } else if (relayResponse instanceof Error) {
      // Remove node from session if error is due to max relays allowed reached
      if (relayResponse.message === MAX_RELAYS_ERROR) {
        await removeNodeFromSession(this.redis, (pocketSession as Session).sessionKey, node.publicKey)
      }

      return new RelayError(relayResponse.message, 500, node?.publicKey)
      // ConsensusNode
    } else {
      // TODO: ConsensusNode is a possible return
      return new Error('relayResponse is undefined')
    }
  }

  // Fetch node client type if Ethereum based
  async fetchClientTypeLog(blockchainID: string, id: string | undefined): Promise<string | null> {
    const clientTypeLog = await this.redis.get(blockchainID + '-' + id + '-clientType')

    return clientTypeLog
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseMethod(parsedRawData: Record<string, any>): string {
    // Method recording for metrics
    let method = ''

    if (parsedRawData instanceof Array) {
      // Join the methods of calls in an array for chains that can join multiple calls in one
      for (const key in parsedRawData) {
        if (parsedRawData[key].method) {
          if (method) {
            method += ','
          }
          method += parsedRawData[key].method
        }
      }
    } else if (parsedRawData.method) {
      method = parsedRawData.method
    }
    return method
  }

  updateConfiguration(requestTimeOut: number): Configuration {
    return new Configuration(
      this.pocketConfiguration.maxDispatchers,
      this.pocketConfiguration.maxSessions,
      this.pocketConfiguration.consensusNodeCount,
      requestTimeOut,
      this.pocketConfiguration.acceptDisputedResponses,
      this.pocketConfiguration.sessionBlockFrequency,
      this.pocketConfiguration.blockTime,
      this.pocketConfiguration.maxSessionRefreshRetries,
      this.pocketConfiguration.validateRelayResponses,
      this.pocketConfiguration.rejectSelfSignedCertificates,
      this.pocketConfiguration.useLegacyTxCodec
    )
  }

  // Load requested blockchain by parsing the URL
  async loadBlockchain(): Promise<BlockchainDetails> {
    // Load the requested blockchain
    const cachedBlockchains = await this.redis.get('blockchains')
    let blockchains

    if (!cachedBlockchains) {
      blockchains = await this.blockchainsRepository.find()
      await this.redis.set('blockchains', JSON.stringify(blockchains), 'EX', 60)
    } else {
      blockchains = JSON.parse(cachedBlockchains)
    }

    // Split off the first part of the request's host and check for matches
    const blockchainRequest = this.host.split('.')[0]

    const blockchainFilter = blockchains.filter(
      (b: { blockchain: string }) => b.blockchain.toLowerCase() === blockchainRequest.toLowerCase()
    )

    if (blockchainFilter[0]) {
      let blockchainEnforceResult = ''
      let blockchainIDCheck = ''
      let blockchainID = ''
      let blockchainChainID = ''
      let blockchainLogLimitBlocks = 10000 // Should never be 0
      let blockchainSyncCheck: SyncCheckOptions

      const blockchain = blockchainFilter[0].blockchain // ex. 'eth-mainnet'

      blockchainID = blockchainFilter[0].hash as string // ex. '0021'

      // Record the necessary format for the result; example: JSON
      if (blockchainFilter[0].enforceResult) {
        blockchainEnforceResult = blockchainFilter[0].enforceResult
      }
      // Sync Check to determine current blockheight
      if (blockchainFilter[0].syncCheck) {
        blockchainSyncCheck.body = blockchainFilter[0].syncCheck.body.replace(/\\"/g, '"')
        blockchainSyncCheck.resultKey = blockchainFilter[0].syncCheck.resultKey

        // Allowance of blocks a data node can be behind
        blockchainSyncCheck.allowance = parseInt(blockchainFilter[0].syncCheck.allowance)
      }
      // Sync Check path necessary for some chains
      if (blockchainFilter[0].syncCheck.path) {
        blockchainSyncCheck.path = blockchainFilter[0].syncCheck.path
      }
      // Chain ID Check to determine correct chain
      if (blockchainFilter[0].chainIDCheck) {
        blockchainIDCheck = blockchainFilter[0].chainIDCheck.replace(/\\"/g, '"')
        blockchainChainID = blockchainFilter[0].chainID // ex. '100' (xdai) - can also be undefined
      }
      // Max number of blocks to request logs for, if not available, result to env
      if (blockchainFilter[0].logLimitBlocks) {
        blockchainLogLimitBlocks = parseInt(blockchainFilter[0].logLimitBlocks)
      } else if (this.defaultLogLimitBlocks > 0) {
        blockchainLogLimitBlocks = this.defaultLogLimitBlocks
      }

      return Promise.resolve({
        blockchain,
        blockchainEnforceResult,
        blockchainSyncCheck,
        blockchainIDCheck,
        blockchainID,
        blockchainChainID,
        blockchainLogLimitBlocks,
      })
    } else {
      throw new HttpErrors.BadRequest('Incorrect blockchain: ' + this.host)
    }
  }

  async enforceLimits(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parsedRawData: Record<string, any>,
    blockchainID: string,
    logLimitBlocks: number
  ): Promise<string | Error> {
    if (WS_ONLY_METHODS.includes(parsedRawData.method)) {
      return new HttpErrors.BadRequest(
        `We cannot serve ${parsedRawData.method} method over HTTPS. At the moment, we do not support WebSockets.`
      )
    } else if (parsedRawData.method === 'eth_getLogs') {
      let toBlock: number
      let fromBlock: number
      let isToBlockHex = false
      let isFromBlockHex = false
      const altruistUrl = String(this.altruists[blockchainID])
      const [{ fromBlock: fromBlockParam, toBlock: toBlockParam }] = parsedRawData.params as [
        { fromBlock: string; toBlock: string }
      ]

      if (toBlockParam !== undefined && toBlockParam !== 'latest') {
        toBlock = blockHexToDecimal(toBlockParam)
        isToBlockHex = true
      }
      if (fromBlockParam !== undefined && fromBlockParam !== 'latest') {
        fromBlock = blockHexToDecimal(fromBlockParam)
        isFromBlockHex = true
      }

      if ((toBlock !== 0 || fromBlock !== 0) && altruistUrl !== 'undefined') {
        // Altruist
        const rawData = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] })

        let axiosConfig = {}

        try {
          axiosConfig = {
            method: 'POST',
            url: altruistUrl,
            data: rawData,
            headers: { 'Content-Type': 'application/json' },
          }
          const { data } = await axios(axiosConfig)

          const latestBlock = blockHexToDecimal(data.result)

          if (!isToBlockHex) {
            toBlock = latestBlock
          }
          if (!isFromBlockHex) {
            fromBlock = latestBlock
          }
        } catch (e) {
          logger.log('error', `Failed trying to reach altruist (${altruistUrl}) to fetch block number.`)
          return new HttpErrors.InternalServerError('Internal error. Try again with a explicit block number.')
        }
      } else {
        // We cannot move forward if there is no altruist available.
        if (!isToBlockHex || !isFromBlockHex) {
          return new LimitError(`Please use an explicit block number instead of 'latest'.`, parsedRawData.method)
        }
      }
      if (toBlock - fromBlock > logLimitBlocks) {
        return new LimitError(
          `You cannot query logs for more than ${logLimitBlocks} blocks at once.`,
          parsedRawData.method
        )
      }
    }
  }

  filterCheckedNodes(syncCheckNodes: Node[], chainCheckedNodes: Node[]): Node[] {
    // Filters out nodes that passed both checks.
    const nodes = syncCheckNodes.filter((syncCheckNode) =>
      chainCheckedNodes.some((chainCheckedNode) => syncCheckNode.publicKey === chainCheckedNode.publicKey)
    )

    return nodes
  }

  checkSecretKey(application: Applications): boolean {
    // Check secretKey; is it required? does it pass? -- temp allowance for unencrypted keys
    const decryptor = new Decryptor({ key: this.databaseEncryptionKey })

    if (
      application.gatewaySettings.secretKeyRequired && // If the secret key is required by app's settings // and
      application.gatewaySettings.secretKey && // the app's secret key is set // and
      (!this.secretKey || // the request doesn't contain a secret key // or
        this.secretKey.length < 32 || // the secret key is invalid // or
        (this.secretKey.length === 32 && this.secretKey !== application.gatewaySettings.secretKey) || // the secret key does not match plaintext // or
        (this.secretKey.length > 32 && this.secretKey !== decryptor.decrypt(application.gatewaySettings.secretKey))) // does not match encrypted
    ) {
      return false
    }
    return true
  }

  // Check passed in string against an array of whitelisted items
  // Type can be "explicit" or substring match
  checkWhitelist(tests: string[], check: string, type: string): boolean {
    if (!tests || tests.length === 0) {
      return true
    }
    if (!check) {
      return false
    }

    for (const test of tests) {
      if (type === 'explicit') {
        if (test.toLowerCase() === check.toLowerCase()) {
          return true
        }
      } else {
        if (check.toLowerCase().includes(test.toLowerCase())) {
          return true
        }
      }
    }
    return false
  }
}

interface BlockchainDetails {
  blockchain: string
  blockchainEnforceResult: string
  blockchainSyncCheck: SyncCheckOptions
  blockchainIDCheck: string
  blockchainID: string
  blockchainChainID: string
  blockchainLogLimitBlocks: number
}

export interface SendRelayOptions {
  rawData: object | string
  relayPath: string
  httpMethod: HTTPMethod
  application: Applications
  requestID: string
  requestTimeOut?: number
  overallTimeOut?: number
  relayRetries?: number
  logLimitBlocks?: number
}
