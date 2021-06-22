import {inject} from '@loopback/context';
import {FilterExcludingWhere, repository} from '@loopback/repository';
import {post, param, requestBody, HttpErrors} from '@loopback/rest';
import {Applications, LoadBalancers} from '../models';
import {
  ApplicationsRepository,
  BlockchainsRepository,
  LoadBalancersRepository,
} from '../repositories';
import {Pocket, Configuration, HTTPMethod} from '@pokt-network/pocket-js';
import {Redis} from 'ioredis';
import {Pool as PGPool} from 'pg';
import {CherryPicker} from '../services/cherry-picker';
import {MetricsRecorder} from '../services/metrics-recorder';
import {PocketRelayer} from '../services/pocket-relayer';
import {SyncChecker} from '../services/sync-checker';

const logger = require('../services/logger');

export class V1Controller {
  cherryPicker: CherryPicker;
  metricsRecorder: MetricsRecorder;
  pocketRelayer: PocketRelayer;
  syncChecker: SyncChecker;

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
    @inject('databaseEncryptionKey') private databaseEncryptionKey: string,
    @inject('processUID') private processUID: string,
    @inject('fallbackURL') private fallbackURL: string,
    @inject('requestID') private requestID: string,
    @repository(ApplicationsRepository)
    public applicationsRepository: ApplicationsRepository,
    @repository(BlockchainsRepository)
    private blockchainsRepository: BlockchainsRepository,
    @repository(LoadBalancersRepository)
    private loadBalancersRepository: LoadBalancersRepository,
  ) {
    this.cherryPicker = new CherryPicker({
      redis: this.redis,
      checkDebug: this.checkDebug(),
    });
    this.metricsRecorder = new MetricsRecorder({
      redis: this.redis,
      pgPool: this.pgPool,
      cherryPicker: this.cherryPicker,
      processUID: this.processUID,
    });
    this.syncChecker = new SyncChecker(this.redis, this.metricsRecorder);
    this.pocketRelayer = new PocketRelayer({
      host: this.host,
      origin: this.origin,
      userAgent: this.userAgent,
      pocket: this.pocket,
      pocketConfiguration: this.pocketConfiguration,
      cherryPicker: this.cherryPicker,
      metricsRecorder: this.metricsRecorder,
      syncChecker: this.syncChecker,
      redis: this.redis,
      databaseEncryptionKey: this.databaseEncryptionKey,
      secretKey: this.secretKey,
      relayRetries: this.relayRetries,
      blockchainsRepository: this.blockchainsRepository,
      checkDebug: this.checkDebug(),
      fallbackURL: this.fallbackURL,
    });
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
    @param.filter(Applications, {exclude: 'where'})
    filter?: FilterExcludingWhere<Applications>,
  ): Promise<string | Error> {
    // Take the relay path from the end of the endpoint URL
    if (id.match(/[0-9a-zA-Z]{24}~/g))
    {
      this.relayPath = id.slice(24).replace(/~/gi, '/');
      id = id.slice(0,24);
    }

    logger.log('info', 'PROCESSING', {requestID: this.requestID, relayType: 'LB', typeID: id, serviceNode: ''});

    try {
      const loadBalancer = await this.fetchLoadBalancer(id, filter);
      if (loadBalancer?.id) {
        // eslint-disable-next-line 
        const [blockchain, _enforceResult, _syncCheck] = await this.pocketRelayer.loadBlockchain();
        // Fetch applications contained in this Load Balancer. Verify they exist and choose
        // one randomly for the relay.
        const application = await this.fetchLoadBalancerApplication(
          loadBalancer.id,
          loadBalancer.applicationIDs,
          blockchain,
          filter,
        );
        if (application?.id) {
          return this.pocketRelayer.sendRelay(rawData, this.relayPath, this.httpMethod, application, this.requestID, parseInt(loadBalancer.requestTimeOut), parseInt(loadBalancer.overallTimeOut), parseInt(loadBalancer.relayRetries));
        }
      }
    } catch (e) {
      logger.log('error', 'Load balancer not found', {requestID: this.requestID, relayType: 'LB', typeID: id, serviceNode: ''});
      return new HttpErrors.InternalServerError(
        'Load balancer not found',
      );
    }
    
    logger.log('error', 'Load balancer configuration error', {requestID: this.requestID, relayType: 'LB', typeID: id, serviceNode: ''});
    return new HttpErrors.InternalServerError(
      'Load balancer configuration error',
    );
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
    @param.filter(Applications, {exclude: 'where'})
    filter?: FilterExcludingWhere<Applications>,
  ): Promise<string | Error> {
    // Take the relay path from the end of the endpoint URL
    if (id.match(/[0-9a-zA-Z]{24}~/g))
    {
      this.relayPath = id.slice(24).replace(/~/gi, '/');
      id = id.slice(0,24);
    }
    logger.log('info', 'PROCESSING', {requestID: this.requestID, relayType: 'APP', typeID: id, serviceNode: ''});

    try {
      const application = await this.fetchApplication(id, filter);
      if (application?.id) {
        return this.pocketRelayer.sendRelay(rawData, this.relayPath, this.httpMethod, application, this.requestID);
      }
    } catch (e) {
      logger.log('error', 'Application not found', {requestID: this.requestID, relayType: 'APP', typeID: id, serviceNode: ''});
      return new HttpErrors.InternalServerError(
        'Application not found',
      );
    }
    logger.log('error', 'Application not found', {requestID: this.requestID, relayType: 'APP', typeID: id, serviceNode: ''});
    return new HttpErrors.InternalServerError(
      'Application not found'
    );
  }

  // Pull LoadBalancer records from redis then DB
  async fetchLoadBalancer(
    id: string,
    filter: FilterExcludingWhere | undefined,
  ): Promise<LoadBalancers | undefined> {
    const cachedLoadBalancer = await this.redis.get(id);

    if (!cachedLoadBalancer) {
      const loadBalancer = await this.loadBalancersRepository.findById(
        id,
        filter,
      );
      if (loadBalancer?.id) {
        await this.redis.set(id, JSON.stringify(loadBalancer), 'EX', 60);
        return new LoadBalancers(loadBalancer);
      }
      return undefined;
    }
    return new LoadBalancers(JSON.parse(cachedLoadBalancer));
  }

  // Pull Application records from redis then DB
  async fetchApplication(
    id: string,
    filter: FilterExcludingWhere | undefined,
  ): Promise<Applications | undefined> {
    const cachedApplication = await this.redis.get(id);

    if (!cachedApplication) {
      const application = await this.applicationsRepository.findById(
        id,
        filter,
      );
      if (application?.id) {
        await this.redis.set(id, JSON.stringify(application), 'EX', 60);
        return new Applications(application);
      }
      return undefined;
    }
    return new Applications(JSON.parse(cachedApplication));
  }

  // Pull a random Load Balancer Application from redis then DB
  async fetchLoadBalancerApplication(
    id: string,
    applicationIDs: string[],
    blockchain: string,
    filter: FilterExcludingWhere | undefined,
  ): Promise<Applications | undefined> {
    let verifiedIDs: string[] = [];
    const cachedLoadBalancerApplicationIDs = await this.redis.get(
      'applicationIDs-' + id,
    );

    // Fetch from DB if not found in redis
    if (!cachedLoadBalancerApplicationIDs) {
      for (const applicationID of applicationIDs) {
        const application = await this.fetchApplication(applicationID, filter);
        if (application?.id) {
          verifiedIDs.push(application.id);
        }
      }
      await this.redis.set(
        'applicationIDs-' + id,
        JSON.stringify(verifiedIDs),
        'EX',
        60,
      );
    } else {
      verifiedIDs = JSON.parse(cachedLoadBalancerApplicationIDs);
    }

    // Sanity check; make sure applications are configured for this LB
    if (verifiedIDs.length < 1) {
      throw new HttpErrors.Forbidden('Load Balancer configuration invalid');
    }
    /*
    return this.fetchApplication(
      await this.cherryPicker.cherryPickApplication(id, verifiedIDs, blockchain),
      filter,
    );
    */
    return this.fetchApplication(
      verifiedIDs[Math.floor(Math.random() * verifiedIDs.length)],
      filter,
    );
  }

  // Debug log for testing based on user agent
  checkDebug(): boolean {
    if (
      this.userAgent &&
      this.userAgent.toLowerCase().includes('pocket-debug')
    ) {
      return true;
    }
    return false;
  }
}
