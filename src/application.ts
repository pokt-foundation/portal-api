import {BootMixin} from '@loopback/boot';
import {ApplicationConfig, inject} from '@loopback/core';
import {RepositoryMixin} from '@loopback/repository';
import {RestApplication, HttpErrors} from '@loopback/rest';
import {ServiceMixin} from '@loopback/service-proxy';
import {GatewaySequence} from './sequence';
import {Account} from '@pokt-network/pocket-js/dist/keybase/models/account';
import {RelayProfiler} from './services/relay-profiler';

import path from 'path';
import AatPlans from './config/aat-plans.json';

const logger = require('./services/logger');

const pocketJS = require('@pokt-network/pocket-js');
const {Pocket, Configuration, HttpRpcProvider} = pocketJS;

const Redis = require('ioredis');
const crypto = require('crypto');
const os = require('os');
const process = require('process');
const pg = require('pg');
const got = require('got');

require('log-timestamp');
require('dotenv').config();

export class PocketGatewayApplication extends BootMixin(
  ServiceMixin(RepositoryMixin(RestApplication)),
) {
  constructor(options: ApplicationConfig = {}) {
    super(options);
    this.sequence(GatewaySequence);
    this.static('/', path.join(__dirname, '../public'));

    this.projectRoot = __dirname;
    this.bootOptions = {
      controllers: {
        dirs: ['controllers'],
        extensions: ['.controller.js'],
        nested: true,
      },
    };

    this.bind('configuration.environment.load').to(typeof options.env.load !== undefined ? options.env.load : true)
    this.bind('configuration.environment.values').to(options.env.values || {})
  }

  async loadPocket(): Promise<void> {
    // Requirements; for Production these are stored in GitHub repo secrets
    //
    // For Dev, you need to pass them in via .env file
    // TODO: Add env as a type
    const {NODE_ENV,
      GATEWAY_CLIENT_PUBLIC_KEY,
      GATEWAY_CLIENT_PRIVATE_KEY,
      GATEWAY_CLIENT_PASSPHRASE,
      MONGO_ENDPOINT,
      DATABASE_ENCRYPTION_KEY,
      REDIS_ENDPOINT,
      REDIS_PORT,
      PG_CONNECTION,
      PG_CERTIFICATE,
      LOGZ_TOKEN,
      DISPATCH_URL,
      ALTRUISTS,
      POCKET_SESSION_BLOCK_FREQUENCY,
      POCKET_BLOCK_TIME,
      POCKET_RELAY_RETRIES,
      DEFAULT_SYNC_ALLOWANCE,
      AAT_PLAN,
      FALLBACK_URL,
      WATCH} = this.get('configuration.environment.values') as any

    const environment: string = NODE_ENV || 'production';
    const dispatchURL: string = DISPATCH_URL ?? '';
    const fallbackURL: string = FALLBACK_URL ?? '';
    const clientPrivateKey: string =
      process.env.GATEWAY_CLIENT_PRIVATE_KEY ?? '';
    const clientPassphrase: string =
      process.env.GATEWAY_CLIENT_PASSPHRASE ?? '';
    const pocketSessionBlockFrequency: number =
      parseInt(process.env.POCKET_SESSION_BLOCK_FREQUENCY) ?? 0;
    const pocketBlockTime: number =
      parseInt(process.env.POCKET_BLOCK_TIME) ?? 0;
    const relayRetries: number =
      parseInt(process.env.POCKET_RELAY_RETRIES) ?? 0;
    const databaseEncryptionKey: string =
      process.env.DATABASE_ENCRYPTION_KEY ?? '';
    const aatPlan = process.env.AAT_PLAN || AatPlans.PREMIUM;

    if (!dispatchURL) {
      throw new HttpErrors.InternalServerError('DISPATCH_URL required in ENV');
    }
    if (!fallbackURL) {
      throw new HttpErrors.InternalServerError('FALLBACK_URL required in ENV');
    }
    if (!clientPrivateKey) {
      throw new HttpErrors.InternalServerError(
        'GATEWAY_CLIENT_PRIVATE_KEY required in ENV',
      );
    }
    if (!clientPassphrase) {
      throw new HttpErrors.InternalServerError(
        'GATEWAY_CLIENT_PASSPHRASE required in ENV',
      );
    }
    if (!pocketSessionBlockFrequency || pocketSessionBlockFrequency === 0) {
      throw new HttpErrors.InternalServerError(
        'POCKET_SESSION_BLOCK_FREQUENCY required in ENV',
      );
    }
    if (!pocketBlockTime || pocketBlockTime === 0) {
      throw new HttpErrors.InternalServerError(
        'POCKET_BLOCK_TIME required in ENV',
      );
    }
    if (!databaseEncryptionKey) {
      throw new HttpErrors.InternalServerError(
        'DATABASE_ENCRYPTION_KEY required in ENV',
      );
    }
    if (aatPlan !== AatPlans.PREMIUM && !AatPlans.values.includes(aatPlan)) {
      throw new HttpErrors.InternalServerError('Unrecognized AAT Plan');
    }

    const dispatchers = [];

    if (dispatchURL.indexOf(',')) {
      const dispatcherArray = dispatchURL.split(',');
      dispatcherArray.forEach(function (dispatcher) {
        dispatchers.push(new URL(dispatcher));
      });
    } else {
      dispatchers.push(new URL(dispatchURL));
    }

    const configuration = new Configuration(
      50,
      100000,
      0,
      1200000,
      false,
      pocketSessionBlockFrequency,
      pocketBlockTime,
      undefined,
      undefined,
      false,
    );
    const rpcProvider = new HttpRpcProvider(dispatchers);
    const pocket = new Pocket(dispatchers, rpcProvider, configuration);

    // Bind to application context for shared re-use
    this.bind('pocketInstance').to(pocket);
    this.bind('pocketConfiguration').to(configuration);
    this.bind('relayRetries').to(relayRetries);
    this.bind('fallbackURL').to(fallbackURL);
    this.bind('logger').to(logger);

    // Unlock primary client account for relay signing
    try {
      const importAccount = await pocket.keybase.importAccount(
        Buffer.from(clientPrivateKey, 'hex'),
        clientPassphrase,
      );
      if (importAccount instanceof Account) {
        await pocket.keybase.unlockAccount(
          importAccount.addressHex,
          clientPassphrase,
          0,
        );
      }
    } catch (e) {
      logger.log('error', e);
      throw new HttpErrors.InternalServerError(
        'Unable to import or unlock base client account',
      );
    }

    // Load Redis for cache
    const redisEndpoint: string = process.env.REDIS_ENDPOINT || '';
    const redisPort: string = process.env.REDIS_PORT || '';

    if (!redisEndpoint) {
      throw new HttpErrors.InternalServerError(
        'REDIS_ENDPOINT required in ENV',
      );
    }
    if (!redisPort) {
      throw new HttpErrors.InternalServerError('REDIS_PORT required in ENV');
    }
    const redis = new Redis(redisPort, redisEndpoint);
    this.bind('redisInstance').to(redis);

    // Load Postgres for TimescaleDB metrics
    const pgConnection: string = process.env.PG_CONNECTION || '';
    const pgCertificate: string = process.env.PG_CERTIFICATE || '';

    if (!pgConnection) {
      throw new HttpErrors.InternalServerError('PG_CONNECTION required in ENV');
    }

    if (!pgCertificate && environment !== 'development') {
      throw new HttpErrors.InternalServerError(
        'PG_CERTIFICATE required in ENV',
      );
    }

    // Pull public certificate from Redis or s3 if not there
    const cachedCertificate = await redis.get('timescaleDBCertificate');
    let publicCertificate;

    if (environment === 'production') {
      if (!cachedCertificate) {
        try {
          const s3Certificate = await got(pgCertificate);
          publicCertificate = s3Certificate.body;
        } catch (e) {
          throw new HttpErrors.InternalServerError('Invalid Certificate');
        }
        redis.set('timescaleDBCertificate', publicCertificate, 'EX', 600);
      } else {
        publicCertificate = cachedCertificate;
      }
    }

    const ssl =
      environment === 'production'
        ? {
            rejectUnauthorized: false,
            ca: publicCertificate,
          }
        : false;

    const pgConfig = {
      connectionString: pgConnection,
      ssl,
    };

    const pgPool = new pg.Pool(pgConfig);

    this.bind('pgPool').to(pgPool);
    this.bind('databaseEncryptionKey').to(databaseEncryptionKey);
    this.bind('aatPlan').to(aatPlan);

    // Create a UID for this process
    const parts = [os.hostname(), process.pid, +new Date()];
    const hash = crypto.createHash('md5').update(parts.join(''));
    this.bind('processUID').to(hash.digest('hex'));
  }
}
