import { inject } from '@loopback/context'
import { FilterExcludingWhere, repository } from '@loopback/repository'
import { post, param, requestBody, HttpErrors } from '@loopback/rest'
import { Applications, LoadBalancers } from '../models'
import { ApplicationsRepository, BlockchainsRepository, LoadBalancersRepository } from '../repositories'
import { Pocket, Configuration, HTTPMethod } from '@pokt-network/pocket-js'
import { Redis } from 'ioredis'
import { Pool as PGPool } from 'pg'
import { CherryPicker } from '../services/cherry-picker'
import { MetricsRecorder } from '../services/metrics-recorder'
import { PocketRelayer, SendRelayOptions } from '../services/pocket-relayer'
import { SyncChecker } from '../services/sync-checker'
import { ChainChecker } from '../services/chain-checker'

const logger = require('../services/logger')

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
    @inject('httpMethod') private httpMethod: HTTPMethod,
    @inject('relayPath') private relayPath: string,
    @inject('relayRetries') private relayRetries: number,
    @inject('pocketInstance') private pocket: Pocket,
    @inject('pocketConfiguration') private pocketConfiguration: Configuration,
    @inject('redisInstance') private redis: Redis,
    @inject('pgPool') private pgPool: PGPool,
    @inject('pgPool2') private pgPool2: PGPool,
    @inject('databaseEncryptionKey') private databaseEncryptionKey: string,
    @inject('processUID') private processUID: string,
    @inject('altruists') private altruists: string,
    @inject('requestID') private requestID: string,
    @inject('defaultSyncAllowance') private defaultSyncAllowance: number,
    @inject('aatPlan') private aatPlan: string,
    @inject('redirects') private redirects: string,
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
    })
    this.metricsRecorder = new MetricsRecorder({
      redis: this.redis,
      pgPool: this.pgPool,
      pgPool2: this.pgPool2,
      cherryPicker: this.cherryPicker,
      processUID: this.processUID,
    })
    this.syncChecker = new SyncChecker(this.redis, this.metricsRecorder, this.defaultSyncAllowance)
    this.chainChecker = new ChainChecker(this.redis, this.metricsRecorder)
    this.pocketRelayer = new PocketRelayer({
      host: this.host,
      origin: this.origin,
      userAgent: this.userAgent,
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
  ): Promise<string | Error> {
    if (!this.redirects) {
      return new HttpErrors.InternalServerError('No redirect domains allowed')
    }

    for (const redirect of JSON.parse(this.redirects)) {
      if (this.pocketRelayer.host.toLowerCase().includes(redirect.domain, 0)) {
        this.pocketRelayer.host = redirect.blockchain
        return this.loadBalancerRelay(redirect.loadBalancerID, rawData)
      }
    }
    return new HttpErrors.InternalServerError('Invalid domain')
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
  ): Promise<string | Error> {
    // Take the relay path from the end of the endpoint URL
    if (id.match(/[0-9a-zA-Z]{24}~/g)) {
      this.relayPath = id.slice(24).replace(/~/gi, '/')
      id = id.slice(0, 24)
    }

    logger.log('info', 'PROCESSING', {
      requestID: this.requestID,
      relayType: 'LB',
      typeID: id,
      serviceNode: '',
    })

    try {
      const loadBalancer = await this.fetchLoadBalancer(id, filter)

      if (loadBalancer?.id) {
        const {
          blockchain,
          // eslint-disable-next-line
          blockchainEnforceResult: _enforceResult,
          // eslint-disable-next-line
          blockchainSyncCheck: _syncCheck,
        } = await this.pocketRelayer.loadBlockchain()
        // Fetch applications contained in this Load Balancer. Verify they exist and choose
        // one randomly for the relay.
        const application = await this.fetchLoadBalancerApplication(
          loadBalancer.id,
          loadBalancer.applicationIDs,
          blockchain,
          filter
        )

        if (application?.id) {
          const options: SendRelayOptions = {
            rawData,
            relayPath: this.relayPath,
            httpMethod: this.httpMethod,
            application: application,
            requestID: this.requestID,
            requestTimeOut: parseInt(loadBalancer.requestTimeOut),
            overallTimeOut: parseInt(loadBalancer.overallTimeOut),
            relayRetries: parseInt(loadBalancer.relayRetries),
          }

          return await this.pocketRelayer.sendRelay(options)
        }
      }
    } catch (e) {
      logger.log('error', e.message, {
        requestID: this.requestID,
        relayType: 'LB',
        typeID: id,
        serviceNode: '',
      })
      return new HttpErrors.InternalServerError(e.message)
    }

    logger.log('error', 'Load balancer configuration error', {
      requestID: this.requestID,
      relayType: 'LB',
      typeID: id,
      serviceNode: '',
    })
    return new HttpErrors.InternalServerError('Load balancer configuration error')
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
  ): Promise<string | Error> {
    // Take the relay path from the end of the endpoint URL
    if (id.match(/[0-9a-zA-Z]{24}~/g)) {
      this.relayPath = id.slice(24).replace(/~/gi, '/')
      id = id.slice(0, 24)
    }
    logger.log('info', 'PROCESSING', {
      requestID: this.requestID,
      relayType: 'APP',
      typeID: id,
      serviceNode: '',
    })

    try {
      const application = await this.fetchApplication(id, filter)

      if (application?.id) {
        const sendRelayOptions: SendRelayOptions = {
          rawData,
          application,
          relayPath: this.relayPath,
          httpMethod: this.httpMethod,
          requestID: this.requestID,
        }

        return await this.pocketRelayer.sendRelay(sendRelayOptions)
      }
    } catch (e) {
      logger.log('error', e.message, {
        requestID: this.requestID,
        relayType: 'APP',
        typeID: id,
        serviceNode: '',
      })
      return new HttpErrors.InternalServerError(e.message)
    }
    logger.log('error', 'Application not found', {
      requestID: this.requestID,
      relayType: 'APP',
      typeID: id,
      serviceNode: '',
    })
    return new HttpErrors.InternalServerError('Application not found')
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
    blockchain: string,
    filter: FilterExcludingWhere | undefined
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
      throw new HttpErrors.Forbidden('Load Balancer configuration invalid')
    }
    /*
    return this.fetchApplication(
      await this.cherryPicker.cherryPickApplication(id, verifiedIDs, blockchain),
      filter,
    );
    */
    return this.fetchApplication(verifiedIDs[Math.floor(Math.random() * verifiedIDs.length)], filter)
  }

  // Debug log for testing based on user agent
  checkDebug(): boolean {
    if (this.userAgent?.toLowerCase().includes('pocket-debug')) {
      return true
    }
    return false
  }
}
