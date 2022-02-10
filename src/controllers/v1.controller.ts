import { Redis } from 'ioredis'
import jsonrpc, { ErrorObject, JsonRpcError } from 'jsonrpc-lite'
import { Pool as PGPool } from 'pg'
import { inject } from '@loopback/context'
import { FilterExcludingWhere, repository } from '@loopback/repository'
import { get, param, post, requestBody } from '@loopback/rest'
import { Configuration, HTTPMethod, Pocket } from '@pokt-network/pocket-js'
import { WriteApi } from '@influxdata/influxdb-client'

import { Applications, LoadBalancers } from '../models'
import { StickinessOptions } from '../models/load-balancers.model'
import { ApplicationsRepository, BlockchainsRepository, LoadBalancersRepository } from '../repositories'
import { ChainChecker } from '../services/chain-checker'
import { CherryPicker } from '../services/cherry-picker'
import { MetricsRecorder } from '../services/metrics-recorder'
import { PocketRelayer } from '../services/pocket-relayer'
import { SyncChecker } from '../services/sync-checker'
import { checkWhitelist } from '../utils/enforcements'
import { parseRawData, parseRPCID } from '../utils/parsing'
import { loadBlockchain } from '../utils/relayer'
import { SendRelayOptions } from '../utils/types'
const logger = require('../services/logger')

const DEFAULT_STICKINESS_APP_PARAMS = {
  preferredApplicationID: '',
  preferredNodeAddress: '',
  rpcID: 0,
}
const DEFAULT_STICKINESS_PARAMS = {
  stickiness: false,
  duration: 30, // seconds
  useRPCID: true,
  relaysLimit: 0,
  stickyOrigins: [],
  rpcIDThreshold: 2,
}

const MAX_APPLICATION_TRIES = 3

export class V1Controller {
  cherryPicker: CherryPicker
  metricsRecorder: MetricsRecorder
  pocketRelayer: PocketRelayer
  syncChecker: SyncChecker
  chainChecker: ChainChecker

  constructor(
    @inject('secretKey') private secretKey: string,
    @inject('host') private host: string,
    @inject('origin') private origin: string,
    @inject('userAgent') private userAgent: string,
    @inject('contentType') private contentType: string,
    @inject('ipAddress') private ipAddress: string,
    @inject('httpMethod') private httpMethod: HTTPMethod,
    @inject('relayPath') private relayPath: string,
    @inject('relayRetries') private relayRetries: number,
    @inject('pocketInstance') private pocket: Pocket,
    @inject('pocketConfiguration') private pocketConfiguration: Configuration,
    @inject('redisInstance') private redis: Redis,
    @inject('pgPool') private pgPool: PGPool,
    @inject('databaseEncryptionKey') private databaseEncryptionKey: string,
    @inject('processUID') private processUID: string,
    @inject('altruists') private altruists: string,
    @inject('requestID') private requestID: string,
    @inject('defaultSyncAllowance') private defaultSyncAllowance: number,
    @inject('aatPlan') private aatPlan: string,
    @inject('redirects') private redirects: string,
    @inject('defaultLogLimitBlocks') private defaultLogLimitBlocks: number,
    @inject('influxWriteAPI') private influxWriteAPI: WriteApi,
    @inject('archivalChains') private archivalChains: string[],
    @inject('alwaysRedirectToAltruists') private alwaysRedirectToAltruists: boolean,
    @inject('dispatchURL') private dispatchURL: string,
    @repository(ApplicationsRepository)
    public applicationsRepository: ApplicationsRepository,
    @repository(BlockchainsRepository)
    private blockchainsRepository: BlockchainsRepository,
    @repository(LoadBalancersRepository)
    private loadBalancersRepository: LoadBalancersRepository
  ) {
    this.cherryPicker = new CherryPicker({
      redis: this.redis,
      checkDebug: this.checkDebug(),
      archivalChains: this.archivalChains,
    })
    this.metricsRecorder = new MetricsRecorder({
      redis: this.redis,
      influxWriteAPI: this.influxWriteAPI,
      pgPool: this.pgPool,
      cherryPicker: this.cherryPicker,
      processUID: this.processUID,
    })
    this.syncChecker = new SyncChecker(this.redis, this.metricsRecorder, this.defaultSyncAllowance, this.origin)
    this.chainChecker = new ChainChecker(this.redis, this.metricsRecorder, this.origin)
    this.pocketRelayer = new PocketRelayer({
      host: this.host,
      origin: this.origin,
      userAgent: this.userAgent,
      ipAddress: this.ipAddress,
      pocket: this.pocket,
      pocketConfiguration: this.pocketConfiguration,
      cherryPicker: this.cherryPicker,
      metricsRecorder: this.metricsRecorder,
      syncChecker: this.syncChecker,
      chainChecker: this.chainChecker,
      redis: this.redis,
      databaseEncryptionKey: this.databaseEncryptionKey,
      secretKey: this.secretKey,
      relayRetries: this.relayRetries,
      blockchainsRepository: this.blockchainsRepository,
      checkDebug: this.checkDebug(),
      altruists: this.altruists,
      aatPlan: this.aatPlan,
      defaultLogLimitBlocks: this.defaultLogLimitBlocks,
      alwaysRedirectToAltruists: this.alwaysRedirectToAltruists,
      dispatchers: this.dispatchURL,
    })
  }

  /**
   * Redirect simple URLs to specific Load Balancers
   */
  @post('/')
  async redirect(
    @requestBody({
      description: 'Relay Request',
      required: true,
      content: {
        'application/json': {
          'x-parser': 'raw',
        },
      },
    })
    rawData: object
  ): Promise<string | ErrorObject> {
    const parsedRawData = parseRawData(rawData)
    const rpcID = parseRPCID(parsedRawData)

    for (const redirect of JSON.parse(this.redirects)) {
      if (this.pocketRelayer.host.toLowerCase().includes(redirect.domain, 0)) {
        // Modify the host using the stored blockchain name from .env
        this.pocketRelayer.host = redirect.blockchain
        this.host = redirect.blockchain
        return this.loadBalancerRelay(redirect.loadBalancerID, rawData)
      }
    }

    return jsonrpc.error(rpcID, new jsonrpc.JsonRpcError('Invalid domain', -32052)) as ErrorObject
  }

  /**
   * Load Balancer Relay
   *
   * Send a Pocket Relay using a Gateway Load Balancer ID
   *
   * @param id Load Balancer ID
   */
  @post('/v1/lb/{id}', {
    responses: {
      '200': {
        description: 'Relay Response',
        content: {
          'application/json': {},
        },
      },
    },
  })
  async loadBalancerRelay(
    @param.path.string('id') id: string,
    @requestBody({
      description: 'Relay Request',
      required: true,
      content: {
        'application/json': {
          // Skip body parsing
          'x-parser': 'raw',
        },
      },
    })
    rawData: object,
    @param.filter(Applications, { exclude: 'where' })
    filter?: FilterExcludingWhere<Applications>
  ): Promise<string | ErrorObject> {
    const parsedRawData = parseRawData(rawData)
    const reqRPCID = parseRPCID(parsedRawData)

    // Take the relay path from the end of the endpoint URL
    if (id.match(/[0-9a-zA-Z]{24}~/g)) {
      this.relayPath = id.slice(24).replace(/~/gi, '/')
      id = id.slice(0, 24)
    }

    try {
      let loadBalancer = await this.fetchLoadBalancer(id, filter)

      if (!loadBalancer?.id) {
        throw new ErrorObject(reqRPCID, new jsonrpc.JsonRpcError('Load balancer not found', -32054))
      }

      const gigastakeOptions: {
        gigastaked: boolean
        originalAppID: string | undefined
        originalAppPK: string | undefined
        stickinessOptions: StickinessOptions | undefined
      } = {
        gigastaked: loadBalancer.gigastakeRedirect || false,
        originalAppID: undefined,
        originalAppPK: undefined,
        stickinessOptions: undefined,
      }

      // Is this LB marked for gigastakeRedirect?
      // Temporary: will be removed when live
      if (gigastakeOptions.gigastaked) {
        const redirect = JSON.parse(this.redirects).find((rdr) => this.host.toLowerCase().includes(rdr.blockchain))

        if (redirect) {
          const originalLoadBalancer = { ...loadBalancer }

          loadBalancer = await this.fetchLoadBalancer(redirect.loadBalancerID, filter)

          if (!loadBalancer?.id) {
            throw new ErrorObject(reqRPCID, new jsonrpc.JsonRpcError('GS load balancer not found', -32054))
          }

          const originalApp = await this.fetchLoadBalancerApplication(
            originalLoadBalancer.id,
            originalLoadBalancer.applicationIDs,
            undefined,
            filter,
            reqRPCID
          )

          gigastakeOptions.originalAppID = originalApp.id
          gigastakeOptions.originalAppPK = originalApp.freeTierApplicationAccount?.publicKey
            ? originalApp.freeTierApplicationAccount?.publicKey
            : originalApp.publicPocketAccount?.publicKey
          gigastakeOptions.stickinessOptions = originalApp?.stickinessOptions
        }
      }

      // Fetch applications contained in this Load Balancer. Verify they exist and choose
      // one randomly for the relay.
      // For sticking sessions (sessions which must be relied using the same node for data consistency)
      // There's two ways to handle them: rpcID or prefix (full sticky), on rpcID the stickiness works
      // with increasing rpcID relays to maintain consistency and with prefix all relays from a load
      // balancer go to the same app/node regardless the data.
      const { stickiness, duration, useRPCID, relaysLimit, stickyOrigins, rpcIDThreshold } =
        gigastakeOptions?.stickinessOptions || loadBalancer?.stickinessOptions || DEFAULT_STICKINESS_PARAMS
      const stickyKeyPrefix = stickiness && !useRPCID ? loadBalancer?.id : ''

      const { preferredApplicationID, preferredNodeAddress, rpcID } = stickiness
        ? await this.checkClientStickiness(rawData, stickyKeyPrefix, stickyOrigins, this.origin)
        : DEFAULT_STICKINESS_APP_PARAMS

      const application = await this.fetchLoadBalancerApplication(
        loadBalancer.id,
        loadBalancer.applicationIDs,
        preferredApplicationID,
        filter,
        rpcID
      )

      if (!application?.id) {
        throw new ErrorObject(reqRPCID, new jsonrpc.JsonRpcError('No application found in the load balancer', -32055))
      }

      const options: SendRelayOptions = {
        rawData,
        relayPath: this.relayPath,
        httpMethod: this.httpMethod,
        application,
        requestID: this.requestID,
        requestTimeOut: parseInt(loadBalancer.requestTimeOut),
        overallTimeOut: parseInt(loadBalancer.overallTimeOut),
        relayRetries: parseInt(loadBalancer.relayRetries),
        stickinessOptions: {
          stickiness,
          preferredNodeAddress,
          duration,
          keyPrefix: stickyKeyPrefix,
          rpcID,
          relaysLimit,
          stickyOrigins,
          rpcIDThreshold,
        },
        applicationID: gigastakeOptions.originalAppID,
        applicationPublicKey: gigastakeOptions.originalAppPK,
      }

      if (loadBalancer.logLimitBlocks) {
        Object.assign(options, { logLimitBlocks: loadBalancer.logLimitBlocks })
      }

      return await this.pocketRelayer.sendRelay(options)
    } catch (e) {
      if (e instanceof ErrorObject) {
        logger.log('error', e.error.message, {
          requestID: this.requestID,
          relayType: 'LB',
          typeID: id,
          serviceNode: '',
          origin: this.origin,
        })

        return e
      }

      logger.log('error', 'INTERNAL ERROR: ' + JSON.stringify(e), {
        requestID: this.requestID,
        error: e,
        relayType: 'LB',
        typeID: id,
        serviceNode: '',
        origin: this.origin,
        trace: e.stack,
      })

      return jsonrpc.error(reqRPCID, new JsonRpcError('Relay attempts exhausted', -32050))
    }
  }

  /**
   * Application Relay
   *
   * Send a Pocket Relay using a specific Application's ID
   *
   * @param id Application ID
   */
  @post('/v1/{id}', {
    responses: {
      '200': {
        description: 'Relay Response',
        content: {
          'application/json': {},
        },
      },
    },
  })
  async applicationRelay(
    @param.path.string('id') id: string,
    @requestBody({
      description: 'Relay Request',
      required: true,
      content: {
        'application/json': {
          // Skip body parsing
          'x-parser': 'raw',
        },
      },
    })
    rawData: object,
    @param.filter(Applications, { exclude: 'where' })
    filter?: FilterExcludingWhere<Applications>
  ): Promise<string | ErrorObject> {
    let reqRPCID = 1

    // Take the relay path from the end of the endpoint URL
    if (id.match(/[0-9a-zA-Z]{24}~/g)) {
      this.relayPath = id.slice(24).replace(/~/gi, '/')
      id = id.slice(0, 24)
    }

    try {
      const parsedRawData = parseRawData(rawData)

      reqRPCID = parseRPCID(parsedRawData)

      const application = await this.fetchApplication(id, filter)

      if (!application?.id) {
        logger.log('error', 'Application not found', {
          requestID: this.requestID,
          relayType: 'APP',
          typeID: id,
          serviceNode: '',
          origin: this.origin,
        })
        throw new ErrorObject(reqRPCID, new jsonrpc.JsonRpcError('Application not found', -32056))
      }

      const { stickiness, duration, useRPCID, relaysLimit, stickyOrigins } =
        application?.stickinessOptions || DEFAULT_STICKINESS_PARAMS
      const stickyKeyPrefix = stickiness && !useRPCID ? application?.id : ''

      const { preferredNodeAddress, rpcID } = stickiness
        ? await this.checkClientStickiness(rawData, stickyKeyPrefix, stickyOrigins, this.origin)
        : DEFAULT_STICKINESS_APP_PARAMS

      const sendRelayOptions: SendRelayOptions = {
        rawData,
        application,
        relayPath: this.relayPath,
        httpMethod: this.httpMethod,
        requestID: this.requestID,
        stickinessOptions: {
          stickiness,
          preferredNodeAddress,
          duration,
          keyPrefix: stickyKeyPrefix,
          rpcID,
          relaysLimit,
          stickyOrigins,
        },
      }

      return await this.pocketRelayer.sendRelay(sendRelayOptions)
    } catch (e) {
      if (e instanceof ErrorObject) {
        logger.log('error', e.error.message, {
          requestID: this.requestID,
          relayType: 'APP',
          typeID: id,
          serviceNode: '',
          origin: this.origin,
        })

        return e
      }

      if (e instanceof SyntaxError && e.message.includes('JSON')) {
        return jsonrpc.error(reqRPCID, new JsonRpcError('The request body is not proper JSON.', -32066))
      }

      logger.log('error', 'INTERNAL ERROR: ' + JSON.stringify(e), {
        requestID: this.requestID,
        error: e,
        relayType: 'APP',
        typeID: id,
        serviceNode: '',
        origin: this.origin,
        trace: e.stack,
      })

      return jsonrpc.error(reqRPCID, new JsonRpcError('Relay attempts exhausted', -32050))
    }
  }

  /**
   * Load Balancers cannot be relayed through a GET request. Returns message to
   * use POST method instead
   * @param id Load Balancer ID
   * @param rawData
   * @param filter
   * @returns
   */
  @get('/v1/lb/{id}')
  async invalidLoadBalancerRelay(
    @requestBody({
      description: 'Relay Request',
      required: true,
      content: {
        'application/json': {
          // Skip body parsing
          'x-parser': 'raw',
        },
      },
    })
    rawData: object
  ): Promise<ErrorObject> {
    return V1Controller.getInvalidRequestResponse(rawData || '')
  }

  /**
   * Load Balancers cannot be relayed through a GET request. Returns message to
   * use POST method instead
   * @param id Load Balancer ID
   * @param rawData
   * @param filter
   * @returns
   */
  @get('/v1/{id}')
  async invalidApplicationRelay(
    @requestBody({
      description: 'Relay Request',
      required: true,
      content: {
        'application/json': {
          // Skip body parsing
          'x-parser': 'raw',
        },
      },
    })
    rawData: object
  ): Promise<ErrorObject> {
    return V1Controller.getInvalidRequestResponse(rawData || '')
  }

  static getInvalidRequestResponse(rawData: object | string): ErrorObject {
    const parsedRawData = parseRawData(rawData)

    const reqRPCID = parseRPCID(parsedRawData)

    return new ErrorObject(
      reqRPCID,
      new jsonrpc.JsonRpcError('GET requests are not supported. Use POST instead', -32067)
    )
  }

  async checkClientStickiness(
    rawData: object,
    prefix: string,
    stickyOrigins: string[],
    origin: string
  ): Promise<{ preferredApplicationID: string; preferredNodeAddress: string; rpcID: number }> {
    // Parse the raw data to determine the lowest RPC ID in the call
    const parsedRawData = parseRawData(rawData)
    const rpcID = parseRPCID(parsedRawData)

    // Users/bots could fetch several origins from the same ip which not all allow stickiness,
    // this is needed to not trigger stickiness on those other origins if is already saved.
    if (!checkWhitelist(stickyOrigins, origin, 'substring')) {
      return { preferredApplicationID: '', preferredNodeAddress: '', rpcID }
    }

    if (prefix || rpcID > 0) {
      const { blockchainID } = await loadBlockchain(
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

      const keyPrefix = prefix ? prefix : rpcID

      const clientStickyKey = `${keyPrefix}-${this.ipAddress}-${blockchainID}`
      const clientStickyAppNodeRaw = await this.redis.get(clientStickyKey)
      const clientStickyAppNode = JSON.parse(clientStickyAppNodeRaw)

      if (clientStickyAppNode?.applicationID && clientStickyAppNode?.nodeAddress) {
        return {
          preferredApplicationID: clientStickyAppNode.applicationID,
          preferredNodeAddress: clientStickyAppNode.nodeAddress,
          rpcID,
        }
      }
    }
    return { preferredApplicationID: '', preferredNodeAddress: '', rpcID }
  }

  // Pull LoadBalancer records from redis then DB
  async fetchLoadBalancer(id: string, filter: FilterExcludingWhere | undefined): Promise<LoadBalancers | undefined> {
    const cachedLoadBalancer = await this.redis.get(id)

    if (!cachedLoadBalancer) {
      try {
        const loadBalancer = await this.loadBalancersRepository.findById(id, filter)

        await this.redis.set(id, JSON.stringify(loadBalancer), 'EX', 60)
        return new LoadBalancers(loadBalancer)
      } catch (e) {
        return undefined
      }
    }
    return new LoadBalancers(JSON.parse(cachedLoadBalancer))
  }

  // Pull Application records from redis then DB
  async fetchApplication(id: string, filter: FilterExcludingWhere | undefined): Promise<Applications | undefined> {
    const cachedApplication = await this.redis.get(id)

    if (!cachedApplication) {
      try {
        const application = await this.applicationsRepository.findById(id, filter)

        await this.redis.set(id, JSON.stringify(application), 'EX', 60)
        return new Applications(application)
      } catch (e) {
        return undefined
      }
    }
    return new Applications(JSON.parse(cachedApplication))
  }

  // Pull a random Load Balancer Application from redis then DB
  async fetchLoadBalancerApplication(
    id: string,
    applicationIDs: string[],
    preferredApplicationID: string | undefined,
    filter: FilterExcludingWhere | undefined,
    rpcID: number
  ): Promise<Applications | undefined> {
    let verifiedIDs: string[] = []
    const cachedLoadBalancerApplicationIDs = await this.redis.get('applicationIDs-' + id)

    // Fetch from DB if not found in redis
    if (!cachedLoadBalancerApplicationIDs) {
      for (const applicationID of applicationIDs) {
        const application = await this.fetchApplication(applicationID, filter)

        if (application?.id) {
          verifiedIDs.push(application.id)
        }
      }
      await this.redis.set('applicationIDs-' + id, JSON.stringify(verifiedIDs), 'EX', 60)
    } else {
      verifiedIDs = JSON.parse(cachedLoadBalancerApplicationIDs)
    }

    // Sanity check; make sure applications are configured for this LB
    if (verifiedIDs.length < 1) {
      throw new ErrorObject(rpcID, new jsonrpc.JsonRpcError('Load Balancer configuration invalid', -32058))
    }
    /*
    return this.fetchApplication(
      await this.cherryPicker.cherryPickApplication(id, verifiedIDs, blockchain),
      filter,
    );
    */

    // Check if preferred app ID is in set, if so, use that
    if (verifiedIDs.includes(preferredApplicationID)) {
      return this.fetchApplication(preferredApplicationID, filter)
    }

    const verifiedIDsNonExhausted = [...verifiedIDs]
    let applicationID = ''

    // Check whether the application's session is exhausted, on that case try again
    // with another app until the limit is exceeded or all apps are exhausted,
    // otherwise simply pick a random app
    for (let i = 0; i < MAX_APPLICATION_TRIES; i++) {
      if (i < MAX_APPLICATION_TRIES - 1 && verifiedIDsNonExhausted.length > 0) {
        const appIndex = Math.floor(Math.random() * verifiedIDsNonExhausted.length)
        const appID = verifiedIDsNonExhausted[appIndex]

        const isAppExhausted = await this.redis.get(`app-${appID}-exhausted`)

        if (!isAppExhausted) {
          applicationID = appID
          break
        }

        verifiedIDsNonExhausted.splice(appIndex, 1)
      } else {
        applicationID = verifiedIDs[Math.floor(Math.random() * verifiedIDs.length)]
      }
    }
    return this.fetchApplication(applicationID, filter)
  }

  // Debug log for testing based on user agent
  checkDebug(): boolean {
    if (this.userAgent?.toLowerCase().includes('pocket-debug')) {
      return true
    }
    return false
  }
}
