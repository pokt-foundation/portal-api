import { EvidenceSealedError, Relayer } from '@pokt-foundation/pocketjs-relayer'
import { Session, HTTPMethod, Node, PocketAAT } from '@pokt-foundation/pocketjs-types'
import axios, { AxiosRequestConfig, Method } from 'axios'
import { ErrorObject } from 'jsonrpc-lite'
import { HttpErrors } from '@loopback/rest'
import AatPlans from '../config/aat-plans.json'
import { RelayError } from '../errors/types'
import { Applications } from '../models'
import { BlockchainsRepository } from '../repositories'
import { ChainChecker, ChainIDFilterOptions } from '../services/chain-checker'
import { CherryPicker } from '../services/cherry-picker'
import { MetricsRecorder } from '../services/metrics-recorder'
import { removeNodeFromSession } from '../utils/cache'
import { DEFAULT_ALTRUIST_TIMEOUT, SESSION_TIMEOUT, SupportedProtocols } from '../utils/constants'
import {
  checkEnforcementJSON,
  checkSecretKey,
  checkWhitelist,
  isRelayError,
  isUserError,
  SecretKeyDetails,
} from '../utils/enforcements'
import { CombinedError, constructError } from '../utils/errors'
import { getApplicationPublicKey } from '../utils/helpers'
import { enforceJSONRPCRestrictions, validateJSONRPCRelayResponse } from '../utils/jsonrpc/handler'
import { parseMethod, parseRawData, parseRPCID } from '../utils/jsonrpc/parsing'
import { filterCheckedNodes, isCheckPromiseResolved, loadBlockchain } from '../utils/relayer'
import { CheckResult, RelayResponse, SendRelayOptions } from '../utils/types'
import { Cache } from './cache'
import { NodeSticker } from './node-sticker'
import { ConsensusFilterOptions, SyncChecker, SyncCheckOptions } from './sync-checker'

const logger = require('../services/logger')

export class PocketRelayer {
  host: string
  origin: string
  userAgent: string
  ipAddress: string
  relayer: Relayer
  cherryPicker: CherryPicker
  metricsRecorder: MetricsRecorder
  syncChecker: SyncChecker
  chainChecker: ChainChecker
  cache: Cache
  databaseEncryptionKey: string
  secretKey: string
  relayRetries: number
  blockchainsRepository: BlockchainsRepository
  checkDebug: boolean
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
    cherryPicker,
    metricsRecorder,
    syncChecker,
    chainChecker,
    cache,
    databaseEncryptionKey,
    secretKey,
    relayRetries,
    blockchainsRepository,
    checkDebug,
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
    cherryPicker: CherryPicker
    metricsRecorder: MetricsRecorder
    syncChecker: SyncChecker
    chainChecker: ChainChecker
    cache: Cache
    databaseEncryptionKey: string
    secretKey: string
    relayRetries: number
    blockchainsRepository: BlockchainsRepository
    checkDebug: boolean
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
    this.cherryPicker = cherryPicker
    this.metricsRecorder = metricsRecorder
    this.syncChecker = syncChecker
    this.chainChecker = chainChecker
    this.cache = cache
    this.databaseEncryptionKey = databaseEncryptionKey
    this.secretKey = secretKey
    this.relayRetries = relayRetries
    this.blockchainsRepository = blockchainsRepository
    this.checkDebug = checkDebug
    this.aatPlan = aatPlan
    this.defaultLogLimitBlocks = defaultLogLimitBlocks
    this.alwaysRedirectToAltruists = alwaysRedirectToAltruists
    this.dispatchers = dispatchers
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
  }: SendRelayOptions): Promise<string | CombinedError> {
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
      blockchainCommunicationProtocol,
      blockchainSyncCheck,
      blockchainIDCheck,
      blockchainID,
      blockchainChainID,
      blockchainLogLimitBlocks,
      blockchainPath,
      blockchainAltruist,
    } = await loadBlockchain(
      this.host,
      this.cache,
      this.blockchainsRepository,
      this.defaultLogLimitBlocks,
      rpcID
    ).catch((e) => {
      logger.log('error', `Incorrect blockchain: ${this.host}`, {
        origin: this.origin,
      })
      throw e
    })

    // Check for lb-specific log limits
    if (logLimitBlocks === undefined || logLimitBlocks <= 0) {
      logLimitBlocks = blockchainLogLimitBlocks
    }

    relayPath = !relayPath && blockchainPath ? blockchainPath : relayPath

    // Add relay path to URL
    const altruistURL = !relayPath ? blockchainAltruist : `${blockchainAltruist}${relayPath}`

    const { preferredNodeAddress } = stickinessOptions
    const nodeSticker = new NodeSticker(
      stickinessOptions,
      blockchainID,
      this.ipAddress,
      this.cache.remote,
      rawData,
      requestID,
      application.id
    )

    const method = parseMethod(parsedRawData)
    const data = JSON.stringify(parsedRawData)

    let restriction
    switch (blockchainCommunicationProtocol) {
      case SupportedProtocols.JSONRPC:
        restriction = await enforceJSONRPCRestrictions({
          parsedRawData,
          application,
          requestID,
          logLimitBlocks,
          blockchainID,
          altruistURL,
        })

        if (restriction instanceof ErrorObject) {
          logger.log('error', `RESTRICTION ERROR ${blockchainID} req: ${data}`, {
            blockchainID,
            requestID,
            relayType: 'APP',
            error: `${restriction.error.message}`,
            typeID: application.id,
            origin: this.origin,
          })
          return restriction
        }
    }

    const overallStart = process.hrtime()

    const fallbackAvailable = blockchainAltruist ? true : false

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
            })
            throw constructError({
              message: `Overall Timeout exceeded: ${overallTimeOut}`,
              code: -32051,
              id: rpcID.toString(),
              protocol: blockchainCommunicationProtocol,
            })
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
            blockchainCommunicationProtocol,
            blockchainSyncCheck,
            blockchainIDCheck,
            blockchainChainID,
            blockchainPath,
            nodeSticker,
            appPublicKey: applicationPubKey,
            blockchainSyncBackup: String(blockchainAltruist),
          })

          const metricOptions: MetricOptions = {
            requestID,
            applicationID,
            applicationPublicKey,
            preferredNodeAddress,
            blockchainID,
            relayStart,
            fallback: false,
            method: method,
            origin: this.origin,
            data,
            session: this.session,
            gigastakeAppID: applicationID !== application.id ? application.id : undefined,
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let relayResponse: any

          switch (blockchainCommunicationProtocol) {
            case SupportedProtocols.JSONRPC:
              relayResponse = await validateJSONRPCRelayResponse(
                relay,
                nodeSticker,
                this.metricsRecorder,
                metricOptions
              )
          }

          if (relayResponse && !(relayResponse instanceof RelayError)) {
            return relayResponse
          }
        }
      }
    } catch (e) {
      // API specific errors should be propagated so they can be sent as a response
      if (e instanceof ErrorObject || e instanceof HttpErrors.HttpError) {
        throw e
      }

      // Any other error (e.g parsing errors) that should not be propagated as response
      logger.log('error', 'POCKET RELAYER ERROR: ' + e, {
        blockchainID,
        requestID,
        relayType: 'APP',
        typeID: application.id,
        error: e,
        origin: this.origin,
        trace: e.stack,
      })
    }

    // Exhausted network relay attempts; use fallback
    if (fallbackAvailable) {
      const relayStart = process.hrtime()
      let axiosConfig: AxiosRequestConfig = {}

      // Remove user/pass from the altruist URL
      const redactedAltruistURL = String(blockchainAltruist)?.replace(/[\w]*:\/\/[^\/]*@/g, '')

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
            origin: this.origin,
          })
        }

        if (!(fallbackResponse instanceof Error)) {
          let stringifiedResponse: string
          // This could either be a string or a json object
          let responseParsed = fallbackResponse.data

          switch (blockchainCommunicationProtocol) {
            case SupportedProtocols.JSONRPC:
              if (typeof responseParsed === 'string') {
                if (!checkEnforcementJSON(responseParsed)) {
                  throw new Error('Response is not valid JSON')
                }

                responseParsed = JSON.parse(responseParsed)
              }

              stringifiedResponse = JSON.stringify(responseParsed)

              if (isRelayError(stringifiedResponse) && !isUserError(stringifiedResponse)) {
                throw new Error(`Response is not valid: ${stringifiedResponse}`)
              }
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
              responseStart: Buffer.from(JSON.stringify(responseParsed)).toString('utf-8', 0, 200),
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

    throw constructError({
      message: 'Internal JSON-RPC error.',
      code: -32603,
      id: rpcID.toString(),
      protocol: blockchainCommunicationProtocol,
    })
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
    blockchainCommunicationProtocol,
    blockchainSyncCheck,
    blockchainSyncBackup,
    blockchainIDCheck,
    blockchainID,
    blockchainChainID,
    blockchainPath,
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
    blockchainCommunicationProtocol: SupportedProtocols
    blockchainSyncCheck: SyncCheckOptions
    blockchainSyncBackup: string
    blockchainIDCheck: string
    blockchainID: string
    blockchainChainID: string
    blockchainPath: string
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
      throw constructError({
        message: 'SecretKey does not match',
        code: -32059,
        id: rpcID.toString(),
        protocol: blockchainCommunicationProtocol,
      })
    }

    // Whitelist: origins -- explicit matches
    if (!checkWhitelist(application.gatewaySettings.whitelistOrigins, this.origin, 'explicit')) {
      throw constructError({
        message: `Whitelist Origin check failed: ${this.origin}`,
        code: -32060,
        id: rpcID.toString(),
        protocol: blockchainCommunicationProtocol,
      })
    }

    // Whitelist: userAgent -- substring matches
    if (!checkWhitelist(application.gatewaySettings.whitelistUserAgents, this.userAgent, 'substring')) {
      throw constructError({
        message: `Whitelist User Agent check failed: ${this.userAgent}`,
        code: -32061,
        id: rpcID.toString(),
        protocol: blockchainCommunicationProtocol,
      })
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
      const cachedSession = (await this.cache.get(sessionCacheKey)) as string

      if (cachedSession) {
        session = JSON.parse(cachedSession)
      } else {
        session = await this.relayer.getNewSession({
          chain: blockchainID,
          applicationPubKey: application?.gatewayAAT.applicationPublicKey,
          options: {
            retryAttempts: 3,
            rejectSelfSignedCertificates: false,
            timeout: SESSION_TIMEOUT,
          },
        })

        logger.log('info', 'success dispatcher call to obtain session', {
          requestID,
          blockchainID,
          gatewayPublicKey: application?.gatewayAAT.applicationPublicKey,
          typeID: application.id,
          blockHeight: session?.blockHeight,
          sessionBlockHeight: session?.header?.sessionBlockHeight,
        })

        await this.cache.set(sessionCacheKey, JSON.stringify(session), 'EX', 80)
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

    const exhaustedNodes = await this.cache.smembers(sessionCacheKey)

    if (exhaustedNodes.length > 0) {
      nodes = nodes.filter(({ publicKey }) => !exhaustedNodes.includes(publicKey))
    }

    if (nodes.length === 0) {
      logger.log('warn', `SESSION: ${key} has exhausted all node relays`, {
        requestID,
        relayType: 'APP',
        typeID: application.id,
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
        session,
        path: blockchainPath,
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
        session: session,
        httpMethod,
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
      node = await this.cherryPicker.cherryPickNode(application, nodes, blockchainID, requestID, session.key)
    }

    if (this.checkDebug) {
      logger.log('debug', JSON.stringify(session), {
        requestID,
        relayType: 'APP',
        typeID: application.id,
        serviceNode: node?.publicKey,
      })
    }

    // TODO: Refactor try/catch to go with current flow
    let relay: RelayResponse | Error

    try {
      relay = await this.relayer.relay({
        blockchain: blockchainID,
        data,
        method: httpMethod ? httpMethod : '',
        node,
        path: relayPath,
        pocketAAT,
        session,
        options: {
          timeout: requestTimeOut || DEFAULT_ALTRUIST_TIMEOUT,
        },
      })
    } catch (error) {
      relay = error
    }

    if (this.checkDebug) {
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
      switch (blockchainCommunicationProtocol) {
        case SupportedProtocols.JSONRPC:
          if (
            !checkEnforcementJSON(relay.response) || // the relay response is not valid JSON // or
            (isRelayError(relay.response) && !isUserError(relay.response)) // check if the payload indicates relay error, not a user error
          ) {
            // then this result is invalid
            return new RelayError(relay.response, 503, node.publicKey)
          } else {
            await nodeSticker.setStickinessKey(application.id, node.address, this.origin)

            // Success
            return relay
          }
      }
      // Error
    } else if (relay instanceof Error) {
      // Remove node from session if error is due to max relays allowed reached
      if (relay instanceof EvidenceSealedError) {
        await removeNodeFromSession(this.cache, session, node.publicKey, true, requestID, blockchainID)
      }
      return new RelayError(relay.message, 500, node?.publicKey)
      // ConsensusNode
    } else {
      // TODO: ConsensusNode is a possible return
      return new Error('relayResponse is undefined')
    }
  }
}

export type MetricOptions = {
  requestID: string
  applicationID: string
  applicationPublicKey: string
  preferredNodeAddress: string
  blockchainID: string
  relayStart: [number, number]
  fallback: boolean
  method: string
  origin: string
  data: string
  session: Session
  gigastakeAppID: string
}
