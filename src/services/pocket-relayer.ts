import { CherryPicker } from '../services/cherry-picker'
import { MetricsRecorder } from '../services/metrics-recorder'
import { ConsensusFilterOptions, SyncChecker } from '../services/sync-checker'
import { ChainChecker, ChainIDFilterOptions } from '../services/chain-checker'
import { Decryptor } from 'strong-cryptor'
import { HttpErrors } from '@loopback/rest'
import { PocketAAT, Session, RelayResponse, Pocket, Configuration, HTTPMethod, Node } from '@pokt-network/pocket-js'
import { Redis } from 'ioredis'
import { BlockchainsRepository } from '../repositories'
import { Applications } from '../models'
import { RelayError } from '../errors/relay-error'
import { LimitError } from '../errors/limit-error'
import AatPlans from '../config/aat-plans.json'
import { blockHexToDecimal, checkEnforcementJSON, getBlockNumber } from '../utils'

import { JSONObject } from '@loopback/context'

const logger = require('../services/logger')

import axios from 'axios'

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
  }: SendRelayOptions): Promise<string | Error> {
    if (relayRetries !== undefined && relayRetries >= 0) {
      this.relayRetries = relayRetries
    }
    const {
      blockchain,
      blockchainEnforceResult,
      blockchainSyncCheck,
      blockchainSyncCheckPath,
      blockchainSyncAllowance,
      blockchainIDCheck,
      blockchainID,
    } = await this.loadBlockchain()
    const overallStart = process.hrtime()

    // This converts the raw data into formatted JSON then back to a string for relaying.
    // This allows us to take in both [{},{}] arrays of JSON and plain JSON and removes
    // extraneous characters like newlines and tabs from the rawData.
    // Normally the arrays of JSON do not pass the AJV validation used by Loopback.

    const parsedRawData = Object.keys(rawData).length > 0 ? JSON.parse(rawData.toString()) : JSON.stringify(rawData)
    const limitation = await this.enforceLimits(parsedRawData, blockchain)

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
    const fallbackAvailable = this.altruists[blockchain] !== undefined ? true : false

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
        blockchainEnforceResult,
        blockchainSyncCheck,
        blockchainSyncCheckPath,
        blockchainSyncAllowance,
        blockchainIDCheck,
        blockchainID,
        blockchainSyncBackup: String(this.altruists[blockchain]),
      })

      if (!(relayResponse instanceof Error)) {
        // Record success metric
        await this.metricsRecorder.recordMetric({
          requestID: requestID,
          applicationID: application.id,
          applicationPublicKey: application.gatewayAAT.applicationPublicKey,
          blockchain,
          serviceNode: relayResponse.proof.servicerPubKey,
          relayStart,
          result: 200,
          bytes: Buffer.byteLength(relayResponse.payload, 'utf8'),
          delivered: false,
          fallback: false,
          method: method,
          error: undefined,
        })

        // Clear error log
        await this.redis.del(blockchain + '-' + relayResponse.proof.servicerPubKey + '-errors')

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
        await this.redis.incr(blockchain + '-' + relayResponse.servicer_node + '-errors')
        await this.redis.expire(blockchain + '-' + relayResponse.servicer_node + '-errors', 3600)

        let error = relayResponse.message

        if (typeof relayResponse.message === 'object') {
          error = JSON.stringify(relayResponse.message)
        }

        await this.metricsRecorder.recordMetric({
          requestID,
          applicationID: application.id,
          applicationPublicKey: application.gatewayAAT.applicationPublicKey,
          blockchain,
          serviceNode: relayResponse.servicer_node,
          relayStart,
          result: 500,
          bytes: Buffer.byteLength(relayResponse.message, 'utf8'),
          delivered: errorDelivered,
          fallback: false,
          method,
          error,
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
          ? this.altruists[blockchain]
          : `${this.altruists[blockchain]}/${relayPath}`

      // Remove user/pass from the altruist URL
      const redactedAltruistURL = String(this.altruists[blockchain])?.replace(/[\w]*:\/\/[^\/]*@/g, '')

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
          })
        }

        if (!(fallbackResponse instanceof Error)) {
          const responseParsed = JSON.stringify(fallbackResponse.data)

          await this.metricsRecorder.recordMetric({
            requestID: requestID,
            applicationID: application.id,
            applicationPublicKey: application.gatewayAAT.applicationPublicKey,
            blockchain,
            serviceNode: 'fallback:' + redactedAltruistURL,
            relayStart,
            result: 200,
            bytes: Buffer.byteLength(responseParsed, 'utf8'),
            delivered: false,
            fallback: true,
            method: method,
            error: undefined,
          })

          // If return payload is valid JSON, turn it into an object so it is sent with content-type: json
          if (
            blockchainEnforceResult && // Is this blockchain marked for result enforcement and
            blockchainEnforceResult.toLowerCase() === 'json' && // the check is for JSON
            typeof responseParsed === 'string' &&
            (responseParsed.match('{') || responseParsed.match('[{')) // and it matches JSON
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
          })
        }
      } catch (e) {
        logger.log('error', e.message, {
          requestID: requestID,
          relayType: 'FALLBACK',
          typeID: application.id,
          serviceNode: 'fallback:' + redactedAltruistURL,
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
    blockchainSyncCheckPath,
    blockchainSyncAllowance,
    blockchainSyncBackup,
    blockchainIDCheck,
    blockchainID,
  }: {
    data: string
    relayPath: string
    httpMethod: HTTPMethod
    requestID: string
    application: Applications
    requestTimeOut: number | undefined
    blockchain: string
    blockchainEnforceResult: string
    blockchainSyncCheck: string
    blockchainSyncCheckPath: string
    blockchainSyncAllowance: number
    blockchainSyncBackup: string
    blockchainIDCheck: string
    blockchainID: string
  }): Promise<RelayResponse | Error> {
    logger.log('info', 'RELAYING ' + blockchain + ' req: ' + data, {
      requestID: requestID,
      relayType: 'APP',
      typeID: application.id,
      serviceNode: '',
    })

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

    let node

    // Pull the session so we can get a list of nodes and cherry pick which one to use
    const pocketSession = await this.pocket.sessionManager.getCurrentSession(
      pocketAAT,
      blockchain,
      this.pocketConfiguration
    )

    if (pocketSession instanceof Session) {
      let nodes: Node[] = pocketSession.sessionNodes

      if (blockchainIDCheck) {
        // Check Chain ID
        const chainIDOptions: ChainIDFilterOptions = {
          nodes,
          requestID,
          blockchain,
          pocketAAT,
          applicationID: application.id,
          applicationPublicKey: application.gatewayAAT.applicationPublicKey,
          chainCheck: blockchainIDCheck,
          chainID: parseInt(blockchainID),
          pocket: this.pocket,
          pocketConfiguration: this.pocketConfiguration,
        }

        nodes = await this.chainChecker.chainIDFilter(chainIDOptions)
        if (nodes.length === 0) {
          return new Error('ChainID check failure; using fallbacks')
        }
      }

      if (blockchainSyncCheck) {
        // Check Sync
        const consensusFilterOptions: ConsensusFilterOptions = {
          nodes,
          requestID,
          syncCheck: blockchainSyncCheck,
          syncCheckPath: blockchainSyncCheckPath,
          syncAllowance: blockchainSyncAllowance,
          blockchain,
          blockchainSyncBackup,
          applicationID: application.id,
          applicationPublicKey: application.gatewayAAT.applicationPublicKey,
          pocket: this.pocket,
          pocketAAT,
          pocketConfiguration: this.pocketConfiguration,
        }

        nodes = await this.syncChecker.consensusFilter(consensusFilterOptions)
        if (nodes.length === 0) {
          return new Error('Sync check failure; using fallbacks')
        }
      }
      node = await this.cherryPicker.cherryPickNode(application, nodes, blockchain, requestID)
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
      blockchain,
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
      return new RelayError(relayResponse.message, 500, node?.publicKey)
      // ConsensusNode
    } else {
      // TODO: ConsensusNode is a possible return
      return new Error('relayResponse is undefined')
    }
  }

  // Fetch node client type if Ethereum based
  async fetchClientTypeLog(blockchain: string, id: string | undefined): Promise<string | null> {
    const clientTypeLog = await this.redis.get(blockchain + '-' + id + '-clientType')

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
      await this.redis.set('blockchains', JSON.stringify(blockchains), 'EX', 1)
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
      let blockchainSyncCheck = ''
      let blockchainSyncCheckPath = ''
      let blockchainSyncAllowance = 0
      let blockchainIDCheck = ''
      let blockchainID = ''
      const blockchain = blockchainFilter[0].hash as string

      // Record the necessary format for the result; example: JSON
      if (blockchainFilter[0].enforceResult) {
        blockchainEnforceResult = blockchainFilter[0].enforceResult
      }
      // Sync Check to determine current blockheight
      if (blockchainFilter[0].syncCheck) {
        blockchainSyncCheck = blockchainFilter[0].syncCheck.replace(/\\"/g, '"')
      }
      // Sync Check path necessary for some chains
      if (blockchainFilter[0].syncCheckPath) {
        blockchainSyncCheckPath = blockchainFilter[0].syncCheckPath
      }
      // Chain ID Check to determine correct chain
      if (blockchainFilter[0].chainIDCheck) {
        blockchainIDCheck = blockchainFilter[0].chainIDCheck.replace(/\\"/g, '"')
        blockchainID = blockchainFilter[0].chainID
      }
      // Allowance of blocks a data node can be behind
      if (blockchainFilter[0].syncAllowance) {
        blockchainSyncAllowance = parseInt(blockchainFilter[0].syncAllowance)
      }
      return Promise.resolve({
        blockchain,
        blockchainEnforceResult,
        blockchainSyncCheck,
        blockchainSyncCheckPath,
        blockchainSyncAllowance,
        blockchainIDCheck,
        blockchainID,
      })
    } else {
      throw new HttpErrors.BadRequest('Incorrect blockchain: ' + this.host)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async enforceLimits(parsedRawData: Record<string, any>, blockchain: string): Promise<string | Error> {
    if (parsedRawData.method === 'eth_getLogs') {
      let toBlock: number
      let fromBlock: number
      let isToBlockHex = false
      let isFromBlockHex = false
      const altruistUrl = String(this.altruists[blockchain])
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

      if (altruistUrl !== 'undefined') {
        // Altruist
        try {
          if (!isToBlockHex) {
            console.log(`Connecting to: ${altruistUrl}`)
            toBlock = await getBlockNumber(altruistUrl)
          }
          if (!isFromBlockHex) {
            fromBlock = await getBlockNumber(altruistUrl)
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
      if (toBlock - fromBlock > 10000) {
        return new LimitError('You cannot query logs for more than 10,000 blocks at once.', parsedRawData.method)
      }
    }
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
  blockchainSyncCheck: string
  blockchainSyncCheckPath: string
  blockchainSyncAllowance: number
  blockchainIDCheck: string
  blockchainID: string
}

export interface SendRelayOptions {
  rawData: object
  relayPath: string
  httpMethod: HTTPMethod
  application: Applications
  requestID: string
  requestTimeOut?: number
  overallTimeOut?: number
  relayRetries?: number
}
