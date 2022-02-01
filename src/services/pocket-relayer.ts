import axios, { AxiosRequestConfig, Method } from 'axios'
import { Redis } from 'ioredis'
import jsonrpc, { ErrorObject, IParsedObject } from 'jsonrpc-lite'
import { JSONObject } from '@loopback/context'
import { PocketAAT, Session, RelayResponse, Pocket, Configuration, HTTPMethod, Node } from '@pokt-network/pocket-js'
import AatPlans from '../config/aat-plans.json'
import { RelayError } from '../errors/types'
import { Applications } from '../models'
import { BlockchainsRepository } from '../repositories'
import { ChainChecker, ChainIDFilterOptions } from '../services/chain-checker'
import { CherryPicker } from '../services/cherry-picker'
import { MetricsRecorder } from '../services/metrics-recorder'
import { ConsensusFilterOptions, SyncChecker, SyncCheckOptions } from '../services/sync-checker'
import { removeNodeFromSession } from '../utils/cache'
import { MAX_RELAYS_ERROR } from '../utils/constants'
import {
  checkEnforcementJSON,
  isRelayError,
  isUserError,
  checkWhitelist,
  checkSecretKey,
  SecretKeyDetails,
} from '../utils/enforcements'
import { hashBlockchainNodes } from '../utils/helpers'
import { parseJSONRPCError, parseMethod, parseRawData, parseRPCID } from '../utils/parsing'
import { updateConfiguration } from '../utils/pocket'
import { filterCheckedNodes, isCheckPromiseResolved, loadBlockchain } from '../utils/relayer'
import { CheckResult, SendRelayOptions } from '../utils/types'
import { enforceEVMLimits } from './limiter'
import { NodeSticker } from './node-sticker'
import { PocketRPC } from './pocket-rpc'
const logger = require('../services/logger')

export class PocketRelayer {
  host: string
  origin: string
  userAgent: string
  ipAddress: string
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
  pocketSession: Session
  alwaysRedirectToAltruists: boolean
  dispatchers: string

  constructor({
    host,
    origin,
    userAgent,
    ipAddress,
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
    alwaysRedirectToAltruists = false,
    dispatchers,
  }: {
    host: string
    origin: string
    userAgent: string
    ipAddress: string
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
    alwaysRedirectToAltruists?: boolean
    dispatchers?: string
  }) {
    this.host = host
    this.origin = origin
    this.userAgent = userAgent
    this.ipAddress = ipAddress
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
    const appPublicKey = application.freeTierApplicationAccount
      ? //@ts-ignore
        application.freeTierApplicationAccount?.publicKey
      : //@ts-ignore
        application.publicPocketAccount?.publicKey

    // ID/Public key of dummy application in case is coming from a gigastake load balancer,
    // used only for metrics.
    applicationPublicKey = applicationPublicKey ? applicationPublicKey : appPublicKey
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
            return jsonrpc.error(
              rpcID,
              new jsonrpc.JsonRpcError(`Overall Timeout exceeded: ${overallTimeOut}`, -32051)
            ) as ErrorObject
          }

          // Send this relay attempt
          const relayResponse = await this._sendRelay({
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
            appPublicKey,
            blockchainSyncBackup: String(this.altruists[blockchainID]),
          })

          if (!(relayResponse instanceof Error)) {
            // Even if the relay is successful, we could get an invalid response from servide node.
            // We attempt to parse the service node response using jsonrpc-lite lib.
            const parsedRelayResponse = jsonrpc.parse(relayResponse.payload as string) as IParsedObject

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

            if (isUserError(relayResponse.payload)) {
              const userError = parseJSONRPCError(relayResponse.payload)

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
                serviceNode: relayResponse.proof.servicerPubKey,
                relayStart,
                result: 200,
                bytes: Buffer.byteLength(relayResponse.payload, 'utf8'),
                fallback: false,
                method: method,
                error: userErrorMessage,
                code: userErrorCode,
                origin: this.origin,
                data,
                pocketSession: this.pocketSession,
                sticky: await NodeSticker.stickyRelayResult(preferredNodeAddress, relayResponse.proof.servicerPubKey),
                gigastakeAppID: applicationID !== application.id ? application.id : undefined,
                sessionBlockHeight: this.pocketSession?.sessionHeader?.sessionBlockHeight,
              })
              .catch(function log(e) {
                logger.log('error', 'Error recording metrics: ' + e, {
                  requestID,
                  relayType: 'APP',
                  typeID: application.id,
                  serviceNode: relayResponse.proof.servicerPubKey,
                })
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
            // Increment error log
            await this.redis.incr(blockchainID + '-' + relayResponse.servicer_node + '-errors')
            await this.redis.expire(blockchainID + '-' + relayResponse.servicer_node + '-errors', 3600)

            let error = relayResponse.message

            if (typeof relayResponse.message === 'object') {
              error = JSON.stringify(relayResponse.message)
            }

            // If sticky and is over error threshold, remove stickiness
            const sticky = await NodeSticker.stickyRelayResult(preferredNodeAddress, relayResponse.servicer_node)

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
                serviceNode: relayResponse.servicer_node,
                relayStart,
                result: 500,
                bytes: Buffer.byteLength(relayResponse.message, 'utf8'),
                fallback: false,
                method,
                error,
                code: String(relayResponse.code),
                origin: this.origin,
                data,
                pocketSession: this.pocketSession,
                sticky,
                gigastakeAppID: applicationID !== application.id ? application.id : undefined,
                sessionBlockHeight: this.pocketSession?.sessionHeader?.sessionBlockHeight,
              })
              .catch(function log(e) {
                logger.log('error', 'Error recording metrics: ' + e, {
                  requestID,
                  relayType: 'APP',
                  typeID: application.id,
                  serviceNode: relayResponse.servicer_node,
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
        axiosConfig.timeout = requestTimeOut
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
          const responseParsed = JSON.stringify(fallbackResponse.data)

          this.metricsRecorder
            .recordMetric({
              requestID,
              applicationID,
              applicationPublicKey,
              blockchainID,
              serviceNode: 'fallback:' + redactedAltruistURL,
              relayStart,
              result: 200,
              bytes: Buffer.byteLength(responseParsed, 'utf8'),
              fallback: true,
              method: method,
              error: undefined,
              code: undefined,
              origin: this.origin,
              data,
              pocketSession: this.pocketSession,
              gigastakeAppID: applicationID !== application.id ? application.id : undefined,
              sessionBlockHeight: this.pocketSession?.sessionHeader?.sessionBlockHeight,
            })
            .catch(function log(e) {
              logger.log('error', 'Error recording metrics: ' + e, {
                requestID,
                relayType: 'APP',
                typeID: application.id,
                serviceNode: 'fallback:' + redactedAltruistURL,
              })
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
            requestID,
            relayType: 'FALLBACK',
            typeID: application.id,
            serviceNode: 'fallback:' + redactedAltruistURL,
            blockchainID,
            origin: this.origin,
          })
        }
      } catch (e) {
        logger.log('error', e.message, {
          requestID,
          relayType: 'FALLBACK',
          typeID: application.id,
          serviceNode: 'fallback:' + redactedAltruistURL,
          blockchainID,
          origin: this.origin,
        })
      }
    }
    return jsonrpc.error(rpcID, new jsonrpc.JsonRpcError('Relay attempts exhausted', -32050)) as ErrorObject
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

    const pocketRPC = new PocketRPC(this.dispatchers)

    const pocketSession = await pocketRPC.dispatchNewSession({
      appPublicKey,
      blockchainID,
      sessionHeight: 0,
      applicationID: application.id,
      origin: this.origin,
      requestID,
    })

    let nodes: Node[] = pocketSession.sessionNodes

    // Start the relay timer
    const relayStart = process.hrtime()

    // sessionKey = "blockchain and a hash of the all the nodes in this session, sorted by public key"
    const sessionKey = await hashBlockchainNodes(blockchainID, nodes, this.redis)

    this.pocketSession = pocketSession
    const sessionCacheKey = `session-${sessionKey}`

    const exhaustedNodes = await this.redis.smembers(sessionCacheKey)

    if (exhaustedNodes.length > 0) {
      nodes = nodes.filter(({ publicKey }) => !exhaustedNodes.includes(publicKey))
    }

    if (nodes.length === 0) {
      logger.log('warn', `SESSION: ${sessionKey} has exhausted all node relays`, {
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
        pocketAAT,
        applicationID,
        applicationPublicKey,
        chainCheck: blockchainIDCheck,
        chainID: parseInt(blockchainChainID),
        pocket: this.pocket,
        pocketConfiguration: this.pocketConfiguration,
        pocketSession,
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
        pocket: this.pocket,
        pocketAAT,
        pocketConfiguration: this.pocketConfiguration,
        pocketSession,
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
            pocketSession,
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
            pocketSession,
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
      logger.log('debug', JSON.stringify(pocketSession), {
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
        requestID,
        relayType: 'APP',
        typeID: application.id,
        serviceNode: node?.publicKey,
      })
      logger.log('debug', JSON.stringify(relayResponse), {
        requestID,
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
          (isRelayError(relayResponse.payload) && !isUserError(relayResponse.payload))) // check if the payload indicates relay error, not a user error
      ) {
        // then this result is invalid
        return new RelayError(relayResponse.payload, 503, relayResponse.proof.servicerPubKey)
      } else {
        await nodeSticker.setStickinessKey(application.id, node.address, this.origin)

        // Success
        return relayResponse
      }
      // Error
    } else if (relayResponse instanceof Error) {
      // Remove node from session if error is due to max relays allowed reached
      if (relayResponse.message === MAX_RELAYS_ERROR) {
        await removeNodeFromSession(this.redis, blockchainID, (pocketSession as Session).sessionNodes, node.publicKey)
      }
      return new RelayError(relayResponse.message, 500, node?.publicKey)
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
