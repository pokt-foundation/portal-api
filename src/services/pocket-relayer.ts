import { Relayer } from '@pokt-foundation/pocketjs-relayer'
import { Session, Node, PocketAAT } from '@pokt-foundation/pocketjs-types'
import axios, { AxiosRequestConfig, Method } from 'axios'
import { Redis } from 'ioredis'
import jsonrpc, { ErrorObject, IParsedObject } from 'jsonrpc-lite'
import { JSONObject } from '@loopback/context'
import { Configuration, HTTPMethod } from '@pokt-network/pocket-js'
import AatPlans from '../config/aat-plans.json'
import { RelayError } from '../errors/types'
import { Applications } from '../models'
import { BlockchainsRepository } from '../repositories'
import { ChainChecker, ChainIDFilterOptions } from '../services/chain-checker'
import { CherryPicker } from '../services/cherry-picker'
import { MetricsRecorder } from '../services/metrics-recorder'
import { ConsensusFilterOptions, SyncChecker, SyncCheckOptions } from '../services/sync-checker'
import { removeNodeFromSession } from '../utils/cache'
import { MAX_RELAYS_ERROR, SESSION_TIMEOUT, DEFAULT_ALTRUIST_TIMEOUT } from '../utils/constants'
import {
  checkEnforcementJSON,
  isRelayError,
  isUserError,
  checkWhitelist,
  checkSecretKey,
  SecretKeyDetails,
} from '../utils/enforcements'
import { getApplicationPublicKey } from '../utils/helpers'
import { parseJSONRPCError, parseMethod, parseRawData, parseRPCID } from '../utils/parsing'
import { updateConfiguration } from '../utils/pocket'
import { filterCheckedNodes, isCheckPromiseResolved, loadBlockchain } from '../utils/relayer'
import { CheckResult, RelayResponse, SendRelayOptions } from '../utils/types'
import { enforceEVMLimits } from './limiter'
import { NodeSticker } from './node-sticker'

const logger = require('../services/logger')

export class PocketRelayer {
  host: string
  origin: string
  userAgent: string
  ipAddress: string
  relayer: Relayer
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
  session: Session
  alwaysRedirectToAltruists: boolean
  dispatchers: string

  constructor({
    host,
    origin,
    userAgent,
    ipAddress,
    relayer,
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
    alwaysRedirectToAltruists = false,
    dispatchers,
  }: {
    host: string
    origin: string
    userAgent: string
    ipAddress: string
    relayer: Relayer
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
    alwaysRedirectToAltruists?: boolean
    dispatchers?: string
  }) {
    this.host = host
    this.origin = origin
    this.userAgent = userAgent
    this.ipAddress = ipAddress
    this.relayer = relayer
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
    this.alwaysRedirectToAltruists = alwaysRedirectToAltruists
    this.dispatchers = dispatchers

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
    stickinessOptions,
    logLimitBlocks,
    applicationID,
    applicationPublicKey,
  }: SendRelayOptions): Promise<string | ErrorObject> {
    if (relayRetries !== undefined && relayRetries >= 0) {
      this.relayRetries = relayRetries
    }

    // Actual application's public key
    // TODO: Simplify public key logic once the database discrepancies are fixed
    const applicationPubKey = getApplicationPublicKey(application)

    // ID/Public key of dummy application in case is coming from a gigastake load balancer,
    // used only for metrics.
    applicationPublicKey = applicationPublicKey ? applicationPublicKey : applicationPubKey
    applicationID = applicationID ? applicationID : application.id

    // This converts the raw data into formatted JSON then back to a string for relaying.
    // This allows us to take in both [{},{}] arrays of JSON and plain JSON and removes
    // extraneous characters like newlines and tabs from the rawData.
    // Normally the arrays of JSON do not pass the AJV validation used by Loopback.
    const parsedRawData = parseRawData(rawData)
    const rpcID = parseRPCID(parsedRawData)

    const {
      blockchainEnforceResult,
      blockchainSyncCheck,
      blockchainIDCheck,
      blockchainID,
      blockchainChainID,
      blockchainLogLimitBlocks,
    } = await loadBlockchain(
      this.host,
      this.redis,
      this.blockchainsRepository,
      this.defaultLogLimitBlocks,
      rpcID
    ).catch((e) => {
      logger.log('error', `Incorrect blockchain: ${this.host}`, {
        origin: this.origin,
      })
      throw e
    })

    const { preferredNodeAddress } = stickinessOptions
    const nodeSticker = new NodeSticker(
      stickinessOptions,
      blockchainID,
      this.ipAddress,
      this.redis,
      rawData,
      requestID,
      application.id
    )

    const overallStart = process.hrtime()

    // Check for lb-specific log limits
    if (logLimitBlocks === undefined || logLimitBlocks <= 0) {
      logLimitBlocks = blockchainLogLimitBlocks
    }

    const data = JSON.stringify(parsedRawData)
    const limitation = await this.enforceLimits(parsedRawData, blockchainID, requestID, logLimitBlocks)

    if (limitation instanceof ErrorObject) {
      logger.log('error', `LIMITATION ERROR ${blockchainID} req: ${data}`, {
        blockchainID,
        requestID,
        relayType: 'APP',
        error: `${parsedRawData.method} method limitations exceeded.`,
        typeID: application.id,
        serviceNode: '',
        origin: this.origin,
      })
      return limitation
    }
    const method = parseMethod(parsedRawData)
    const fallbackAvailable = this.altruists[blockchainID] !== undefined ? true : false

    try {
      if (!this.alwaysRedirectToAltruists) {
        // Retries if applicable
        for (let x = 0; x <= this.relayRetries; x++) {
          const relayStart = process.hrtime()

          // Compute the overall time taken on this LB request
          const overallCurrent = process.hrtime(overallStart)
          const overallCurrentElasped = Math.round((overallCurrent[0] * 1e9 + overallCurrent[1]) / 1e6)

          if (overallTimeOut && overallCurrentElasped > overallTimeOut) {
            logger.log('error', 'Overall Timeout exceeded: ' + overallTimeOut, {
              requestID,
              relayType: 'APP',
              typeID: application.id,
              serviceNode: '',
            })
            throw new ErrorObject(
              rpcID,
              new jsonrpc.JsonRpcError(`Overall Timeout exceeded: ${overallTimeOut}`, -32051)
            )
          }

          // Send this relay attempt
          const relay = await this._sendRelay({
            data,
            relayPath,
            httpMethod,
            requestID,
            application,
            applicationID,
            applicationPublicKey,
            requestTimeOut,
            blockchainID,
            blockchainEnforceResult,
            blockchainSyncCheck,
            blockchainIDCheck,
            blockchainChainID,
            nodeSticker,
            appPublicKey: applicationPubKey,
            blockchainSyncBackup: String(this.altruists[blockchainID]),
          })

          // TODO: Remove references of relayResponse and change for pocketjs v2 Response object
          if (!(relay instanceof Error)) {
            // Even if the relay is successful, we could get an invalid response from servide node.
            // We attempt to parse the service node response using jsonrpc-lite lib.

            const parsedRelayResponse = jsonrpc.parse(relay.response as string) as IParsedObject

            // If the parsing goes wrong, we get a response with 'invalid' type and the following message.
            // We could get 'invalid' and not a parse error, hence we check both.
            if (parsedRelayResponse.type === 'invalid' && parsedRelayResponse.payload.message === 'Parse error') {
              throw new ErrorObject(
                rpcID,
                new jsonrpc.JsonRpcError('Service Node returned an invalid response', -32065)
              )
            }
            // Check for user error to bubble these up to the API
            let userErrorMessage = ''
            let userErrorCode = ''

            if (isUserError(relay.response)) {
              const userError = parseJSONRPCError(relay.response)

              userErrorMessage = userError.message
              userErrorCode = userError.code !== 0 ? String(userError.code) : ''
            }

            // Record success metric
            this.metricsRecorder
              .recordMetric({
                requestID,
                applicationID,
                applicationPublicKey,
                blockchainID,
                serviceNode: '-',
                relayStart,
                result: 200,
                bytes: Buffer.byteLength(relay.response, 'utf8'),
                fallback: false,
                method: method,
                error: userErrorMessage,
                code: userErrorCode,
                origin: this.origin,
                data,
                session: this.session,
                // TODO: Add servicerPublicKey again once is implemented on sdk
                // sticky: await NodeSticker.stickyRelayResult(preferredNodeAddress, relayResponse.proof.servicerPubKey),
                gigastakeAppID: applicationID !== application.id ? application.id : undefined,
              })
              .catch(function log(e) {
                logger.log('error', 'Error recording metrics: ' + e, {
                  requestID,
                  relayType: 'APP',
                  typeID: application.id,
                  serviceNode: '-',
                })
              })

            // Clear error log
            // TODO: Implement servicerPubKey and uncomment
            // await this.redis.del(blockchainID + '-' + relayResponse.proof.servicerPubKey + '-errors')

            // If return payload is valid JSON, turn it into an object so it is sent with content-type: json
            if (
              blockchainEnforceResult && // Is this blockchain marked for result enforcement // and
              blockchainEnforceResult.toLowerCase() === 'json' // the check is for JSON
            ) {
              return JSON.parse(relay.response)
            }
            return relay.response
          } else if (relay instanceof RelayError) {
            // Record failure metric, retry if possible or fallback
            // Increment error log
            await this.redis.incr(blockchainID + '-' + relay.servicer_node + '-errors')
            await this.redis.expire(blockchainID + '-' + relay.servicer_node + '-errors', 3600)

            let error = relay.message

            if (typeof relay.message === 'object') {
              error = JSON.stringify(relay.message)
            }

            // If sticky and is over error threshold, remove stickiness
            const sticky = await NodeSticker.stickyRelayResult(preferredNodeAddress, relay.servicer_node)

            if (sticky === 'SUCCESS') {
              const errorCount = await nodeSticker.increaseErrorCount()

              if (errorCount > 5) {
                await nodeSticker.remove('error limit exceeded')
              }
            }

            this.metricsRecorder
              .recordMetric({
                requestID,
                applicationID,
                applicationPublicKey,
                blockchainID,
                serviceNode: relay.servicer_node,
                relayStart,
                result: 500,
                bytes: Buffer.byteLength(relay.message, 'utf8'),
                fallback: false,
                method,
                error,
                code: String(relay.code),
                origin: this.origin,
                data,
                // TODO: Add pocket session again
                session: this.session,
                sticky,
                gigastakeAppID: applicationID !== application.id ? application.id : undefined,
              })
              .catch(function log(e) {
                logger.log('error', 'Error recording metrics: ' + e, {
                  requestID,
                  relayType: 'APP',
                  typeID: application.id,
                  serviceNode: relay.servicer_node,
                })
              })
          }
        }
      }
    } catch (e) {
      // Explicit JSON-RPC errors should be propagated so they can be sent as a response
      if (e instanceof ErrorObject) {
        throw e
      }

      // Any other error (e.g parsing errors) that should not be propagated as response
      logger.log('error', 'POCKET RELAYER ERROR: ' + e, {
        requestID,
        relayType: 'APP',
        typeID: application.id,
        error: e,
        serviceNode: '',
        origin: this.origin,
        trace: e.stack,
      })
    }

    // Exhausted network relay attempts; use fallback
    if (fallbackAvailable) {
      const relayStart = process.hrtime()
      let axiosConfig: AxiosRequestConfig = {}

      // Add relay path to URL
      const altruistURL =
        relayPath === undefined || relayPath === ''
          ? (this.altruists[blockchainID] as string)
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
          method: httpMethod as Method,
          url: altruistURL,
          data: rawData.toString(),
        }
      }

      if (requestTimeOut) {
        axiosConfig.timeout = DEFAULT_ALTRUIST_TIMEOUT
      }

      try {
        const fallbackResponse = await axios(axiosConfig)

        if (this.checkDebug) {
          logger.log('debug', JSON.stringify(fallbackResponse.data), {
            requestID,
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
          // This could either be a string or a json object
          let responseParsed = fallbackResponse.data

          // If return payload is a string and blockchain has json enforcement,
          // turn it into an object so it is sent with content-type: json
          if (
            blockchainEnforceResult && // Is this blockchain marked for result enforcement and
            blockchainEnforceResult.toLowerCase() === 'json' && // the check is for JSON
            typeof fallbackResponse.data === 'string'
          ) {
            // If the fallback response string is not valid JSON,
            // we throw because a parsing error would occur.
            if (!checkEnforcementJSON(fallbackResponse.data)) {
              throw new Error('Response is not valid JSON')
            }

            responseParsed = JSON.parse(fallbackResponse.data)
          }

          this.metricsRecorder
            .recordMetric({
              requestID,
              applicationID,
              applicationPublicKey,
              blockchainID,
              serviceNode: 'fallback:' + redactedAltruistURL,
              relayStart,
              result: 200,
              bytes: Buffer.byteLength(JSON.stringify(responseParsed), 'utf8'),
              fallback: true,
              method: method,
              error: undefined,
              code: undefined,
              origin: this.origin,
              data,
              session: this.session,
              gigastakeAppID: applicationID !== application.id ? application.id : undefined,
            })
            .catch(function log(e) {
              logger.log('error', 'Error recording metrics: ' + e, {
                requestID,
                relayType: 'APP',
                typeID: application.id,
                serviceNode: 'fallback:' + redactedAltruistURL,
              })
            })

          return responseParsed
        } else {
          logger.log('error', 'FAILURE FALLBACK RELAYING', {
            requestID,
            error: JSON.stringify(fallbackResponse),
            relayType: 'FALLBACK',
            typeID: application.id,
            serviceNode: 'fallback:' + redactedAltruistURL,
            blockchainID,
            origin: this.origin,
          })
        }
      } catch (e) {
        logger.log('error', 'INTERNAL FAILURE FALLBACK: ' + e.message, {
          requestID,
          error: e,
          relayType: 'FALLBACK',
          typeID: application.id,
          serviceNode: 'fallback:' + redactedAltruistURL,
          blockchainID,
          origin: this.origin,
        })
      }
    }

    logger.log('error', `RELAY ATTEMPTS EXHAUSTED req: ${rawData.toString()}`, {
      requestID,
      error: 'Relay attempts exhausted',
      relayType: 'EXHAUSTED',
      typeID: application.id,
      blockchainID,
      origin: this.origin,
    })

    throw new ErrorObject(rpcID, new jsonrpc.JsonRpcError('Internal JSON-RPC error.', -32603))
  }

  // Private function to allow relay retries
  async _sendRelay({
    data,
    relayPath,
    httpMethod,
    requestID,
    application,
    applicationID,
    applicationPublicKey,
    requestTimeOut,
    blockchainEnforceResult,
    blockchainSyncCheck,
    blockchainSyncBackup,
    blockchainIDCheck,
    blockchainID,
    blockchainChainID,
    nodeSticker,
    appPublicKey,
  }: {
    data: string
    relayPath: string
    httpMethod: HTTPMethod
    requestID: string
    application: Applications
    applicationID: string
    applicationPublicKey: string
    requestTimeOut: number | undefined
    blockchainEnforceResult: string
    blockchainSyncCheck: SyncCheckOptions
    blockchainSyncBackup: string
    blockchainIDCheck: string
    blockchainID: string
    blockchainChainID: string
    nodeSticker: NodeSticker
    appPublicKey: string
  }): Promise<RelayResponse | Error> {
    const secretKeyDetails: SecretKeyDetails = {
      secretKey: this.secretKey,
      databaseEncryptionKey: this.databaseEncryptionKey,
    }

    const parsedRawData = parseRawData(data)
    const rpcID = parseRPCID(parsedRawData)

    // Secret key check
    if (!checkSecretKey(application, secretKeyDetails)) {
      throw new ErrorObject(rpcID, new jsonrpc.JsonRpcError('SecretKey does not match', -32059))
    }

    // Whitelist: origins -- explicit matches
    if (!checkWhitelist(application.gatewaySettings.whitelistOrigins, this.origin, 'explicit')) {
      throw new ErrorObject(rpcID, new jsonrpc.JsonRpcError(`Whitelist Origin check failed: ${this.origin}`, -32060))
    }

    // Whitelist: userAgent -- substring matches
    if (!checkWhitelist(application.gatewaySettings.whitelistUserAgents, this.userAgent, 'substring')) {
      throw new ErrorObject(
        rpcID,
        new jsonrpc.JsonRpcError(`Whitelist User Agent check failed: ${this.userAgent}`, -32061)
      )
    }

    const pocketAAT: PocketAAT =
      this.aatPlan === AatPlans.FREEMIUM
        ? {
            version: application?.gatewayAAT?.version,
            clientPublicKey: application?.freeTierAAT?.clientPublicKey,
            applicationPublicKey: application?.freeTierAAT?.applicationPublicKey,
            applicationSignature: application?.freeTierAAT?.applicationSignature,
          }
        : {
            version: application?.gatewayAAT?.version,
            clientPublicKey: application?.gatewayAAT?.clientPublicKey,
            applicationPublicKey: application?.gatewayAAT?.applicationPublicKey,
            applicationSignature: application?.gatewayAAT?.applicationSignature,
          }

    // Pull the session so we can get a list of nodes and cherry pick which one to use
    let session: Session

    try {
      const sessionCacheKey = `session-cached-${application?.gatewayAAT.applicationPublicKey}-${blockchainID}`
      const cachedSession = await this.redis.get(sessionCacheKey)

      if (cachedSession) {
        session = JSON.parse(cachedSession)
      } else {
        session = await this.relayer.getNewSession({
          chain: blockchainID,
          applicationPubKey: appPublicKey,
          options: {
            retryAttempts: 3,
            rejectSelfSignedCertificates: false,
            timeout: SESSION_TIMEOUT,
          },
        })

        // TODO: Remove when sdk does it internally
        // @ts-ignore
        session.nodes.forEach((node) => (node.stakedTokens = node.stakedTokens.toString()))

        await this.redis.set(sessionCacheKey, JSON.stringify(session), 'EX', 90)
      }
    } catch (error) {
      logger.log('error', 'ERROR obtaining a session: ' + error, {
        relayType: 'APP',
        typeID: application.id,
        origin: this.origin,
        blockchainID,
        requestID,
        error: error.message,
      })

      return error
    }
    this.session = session

    // Start the relay timer
    const relayStart = process.hrtime()

    let nodes: Node[] = session.nodes

    this.session = session
    // sessionKey = "blockchain and a hash of the all the nodes in this session, sorted by public key"
    const { key } = session

    this.session = session
    const sessionCacheKey = `session-key-${key}`

    const exhaustedNodes = await this.redis.smembers(sessionCacheKey)

    if (exhaustedNodes.length > 0) {
      nodes = nodes.filter(({ publicKey }) => !exhaustedNodes.includes(publicKey))
    }

    if (nodes.length === 0) {
      logger.log('warn', `SESSION: ${key} has exhausted all node relays`, {
        requestID,
        relayType: 'APP',
        typeID: application.id,
        serviceNode: '',
        blockchainID,
        origin: this.origin,
      })
      return new Error("session doesn't have any available nodes")
    }

    let syncCheckPromise: Promise<CheckResult>
    let syncCheckedNodes: Node[]

    let chainCheckPromise: Promise<CheckResult>
    let chainCheckedNodes: Node[]

    if (blockchainIDCheck) {
      // Check Chain ID
      const chainIDOptions: ChainIDFilterOptions = {
        nodes,
        requestID,
        blockchainID,
        pocketAAT: pocketAAT,
        applicationID,
        applicationPublicKey,
        chainCheck: blockchainIDCheck,
        chainID: parseInt(blockchainChainID),
        relayer: this.relayer,
        pocketConfiguration: this.pocketConfiguration,
        session,
      }

      chainCheckPromise = this.chainChecker.chainIDFilter(chainIDOptions)
    }

    if (blockchainSyncCheck) {
      // Check Sync
      const consensusFilterOptions: ConsensusFilterOptions = {
        nodes,
        requestID,
        syncCheckOptions: blockchainSyncCheck,
        blockchainID,
        blockchainSyncBackup,
        applicationID,
        applicationPublicKey,
        relayer: this.relayer,
        pocketAAT: pocketAAT,
        pocketConfiguration: this.pocketConfiguration,
        session: session,
      }

      syncCheckPromise = this.syncChecker.consensusFilter(consensusFilterOptions)
    }

    const checkersPromise = Promise.allSettled([chainCheckPromise, syncCheckPromise])

    const [chainCheckResult, syncCheckResult] = await checkersPromise

    if (blockchainIDCheck) {
      if (isCheckPromiseResolved(chainCheckResult)) {
        chainCheckedNodes = (chainCheckResult as PromiseFulfilledResult<CheckResult>).value.nodes
      } else {
        const error = 'ChainID check failure: '

        const method = 'checks'

        this.metricsRecorder
          .recordMetric({
            requestID,
            applicationID,
            applicationPublicKey,
            blockchainID,
            serviceNode: 'session-failure',
            relayStart,
            result: 500,
            bytes: Buffer.byteLength(error, 'utf8'),
            fallback: false,
            method,
            error,
            code: undefined,
            origin: this.origin,
            data,
            session: this.session,
            gigastakeAppID: applicationID !== application.id ? application.id : undefined,
          })
          .catch(function log(e) {
            logger.log('error', 'Error recording metrics: ' + e, {
              requestID,
              relayType: 'APP',
              typeID: application.id,
              serviceNode: 'session-failure',
            })
          })

        return new Error('ChainID check failure; using fallbacks')
      }
    }

    if (blockchainSyncCheck) {
      if (isCheckPromiseResolved(syncCheckResult)) {
        syncCheckedNodes = (syncCheckResult as PromiseFulfilledResult<CheckResult>).value.nodes
      } else {
        const error = 'Sync check failure'
        const method = 'checks'

        this.metricsRecorder
          .recordMetric({
            requestID,
            applicationID,
            applicationPublicKey,
            blockchainID,
            serviceNode: 'session-failure',
            relayStart,
            result: 500,
            bytes: Buffer.byteLength(error, 'utf8'),
            fallback: false,
            method,
            error,
            code: undefined,
            origin: this.origin,
            data,
            session: this.session,
            gigastakeAppID: applicationID !== application.id ? application.id : undefined,
          })
          .catch(function log(e) {
            logger.log('error', 'Error recording metrics: ' + e, {
              requestID,
              relayType: 'APP',
              typeID: application.id,
              serviceNode: 'session-failure',
            })
          })

        return new Error('Sync check failure; using fallbacks')
      }

      // EVM-chains always have chain/sync checks.
      if (blockchainIDCheck && blockchainSyncCheck) {
        const filteredNodes = filterCheckedNodes(syncCheckedNodes, chainCheckedNodes)

        // There's a chance that no nodes passes both checks.
        if (filteredNodes.length > 0) {
          nodes = filteredNodes
        } else {
          return new Error('Sync / chain check failure; using fallbacks')
        }
      } else if (syncCheckedNodes.length > 0) {
        // For non-EVM chains that only have sync check, like pocket.
        nodes = syncCheckedNodes
      }
    }

    let node: Node

    if (nodeSticker.preferredNodeAddress) {
      node = await nodeSticker.getStickyNode(nodes, exhaustedNodes)
    }

    if (!node) {
      node = await this.cherryPicker.cherryPickNode(application, nodes, blockchainID, requestID, sessionCacheKey)
    }

    if (this.checkDebug) {
      logger.log('debug', JSON.stringify(session), {
        requestID,
        relayType: 'APP',
        typeID: application.id,
        serviceNode: node?.publicKey,
      })
    }

    // Adjust Pocket Configuration for a custom requestTimeOut
    let relayConfiguration = this.pocketConfiguration

    if (requestTimeOut) {
      relayConfiguration = updateConfiguration(this.pocketConfiguration, requestTimeOut)
    }

    // TODO: Refactor try/catch to go with current flow
    let relay: RelayResponse | Error

    try {
      relay = await this.relayer.relay({
        blockchain: blockchainID,
        data,
        method: '',
        node,
        path: relayPath,
        pocketAAT,
        session,
      })
    } catch (error) {
      relay = error
    }

    if (this.checkDebug) {
      logger.log('debug', JSON.stringify(relayConfiguration), {
        requestID,
        relayType: 'APP',
        typeID: application.id,
        serviceNode: node?.publicKey,
      })
      logger.log('debug', JSON.stringify(relay), {
        requestID,
        relayType: 'APP',
        typeID: application.id,
        serviceNode: node?.publicKey,
      })
    }

    // Success
    if (!(relay instanceof Error)) {
      // First, check for the format of the result; Pocket Nodes will return relays that include
      // erroneous results like "invalid host specified" when the node is configured incorrectly.
      // Those results are still marked as 200:success.
      // To filter them out, we will enforce result formats on certain blockchains. If the
      // relay result is not in the correct format, this was not a successful relay.
      if (
        blockchainEnforceResult && // Is this blockchain marked for result enforcement // and
        blockchainEnforceResult.toLowerCase() === 'json' && // the check is for JSON // and
        (!checkEnforcementJSON(relay.response) || // the relay response is not valid JSON // or
          (isRelayError(relay.response) && !isUserError(relay.response))) // check if the payload indicates relay error, not a user error
      ) {
        // then this result is invalid
        return new RelayError(relay.response, 503, node.publicKey)
      } else {
        await nodeSticker.setStickinessKey(application.id, node.address, this.origin)

        // Success
        return relay
      }
      // Error
    } else if (relay instanceof Error) {
      // Remove node from session if error is due to max relays allowed reached
      if (relay.message === MAX_RELAYS_ERROR) {
        await removeNodeFromSession(this.redis, blockchainID, (session as Session).nodes, node.publicKey)
      }
      return new RelayError(relay.message, 500, node?.publicKey)
      // ConsensusNode
    } else {
      // TODO: ConsensusNode is a possible return
      return new Error('relayResponse is undefined')
    }
  }

  async enforceLimits(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parsedRawData: Record<string, any>,
    blockchainID: string,
    requestID: string,
    logLimitBlocks: number
  ): Promise<void | ErrorObject> {
    let limiterResponse: Promise<void | ErrorObject>

    if (blockchainID === '0021') {
      limiterResponse = enforceEVMLimits(parsedRawData, blockchainID, requestID, logLimitBlocks, this.altruists)
    }

    return limiterResponse
  }
}
