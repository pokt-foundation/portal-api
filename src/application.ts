import crypto from 'crypto'
import os from 'os'
import path from 'path'
import process from 'process'
import Redis from 'ioredis'
import pg from 'pg'
import { BootMixin } from '@loopback/boot'
import { ApplicationConfig } from '@loopback/core'
import { RepositoryMixin } from '@loopback/repository'
import { RestApplication, HttpErrors } from '@loopback/rest'
import { ServiceMixin } from '@loopback/service-proxy'
import { InfluxDB } from '@influxdata/influxdb-client'

import AatPlans from './config/aat-plans.json'
import { getPocketInstance } from './config/pocket-config'
import { GatewaySequence } from './sequence'
import { POCKET_JS_INSTANCE_TIMEOUT_KEY, POCKET_JS_TIMEOUT_MAX, POCKET_JS_TIMEOUT_MIN } from './utils/constants'
import { getRandomInt } from './utils/helpers'
const logger = require('./services/logger')

require('log-timestamp')
require('dotenv').config()

// Portal API
export class PocketGatewayApplication extends BootMixin(ServiceMixin(RepositoryMixin(RestApplication))) {
  constructor(options: ApplicationConfig = {}) {
    super(options)
    this.sequence(GatewaySequence)
    this.static('/', path.join(__dirname, '../public'))

    this.projectRoot = __dirname
    this.bootOptions = {
      controllers: {
        dirs: ['controllers'],
        extensions: ['.controller.js'],
        nested: true,
      },
    }

    this.bind('configuration.environment.load').to(typeof options?.env?.load !== undefined ? options.env.load : true)
    this.bind('configuration.environment.values').to(options.env.values || {})
  }

  async loadPocket(): Promise<void> {
    // Requirements; for Production these are stored in GitHub repo secrets
    //
    // For Dev, you need to pass them in via .env file
    // TODO: Add env as a type
    const {
      NODE_ENV,
      GATEWAY_CLIENT_PRIVATE_KEY,
      GATEWAY_CLIENT_PASSPHRASE,
      DATABASE_ENCRYPTION_KEY,
      REDIS_ENDPOINT,
      REDIS_PORT,
      PSQL_CONNECTION,
      DISPATCH_URL,
      POCKET_RELAY_RETRIES,
      DEFAULT_SYNC_ALLOWANCE,
      DEFAULT_LOG_LIMIT_BLOCKS,
      AAT_PLAN,
      COMMIT_HASH,
      INFLUX_URL,
      INFLUX_TOKEN,
      INFLUX_ORG,
      ARCHIVAL_CHAINS,
      ALWAYS_REDIRECT_TO_ALTRUISTS,
    } = await this.get('configuration.environment.values')

    const environment: string = NODE_ENV || 'production'
    const dispatchURL: string = DISPATCH_URL || ''
    const clientPrivateKey: string = GATEWAY_CLIENT_PRIVATE_KEY || ''
    const clientPassphrase: string = GATEWAY_CLIENT_PASSPHRASE || ''
    const relayRetries: string = POCKET_RELAY_RETRIES || ''
    const databaseEncryptionKey: string = DATABASE_ENCRYPTION_KEY || ''
    const defaultSyncAllowance: number = parseInt(DEFAULT_SYNC_ALLOWANCE) || -1
    const defaultLogLimitBlocks: number = parseInt(DEFAULT_LOG_LIMIT_BLOCKS) || 10000
    const aatPlan = AAT_PLAN || AatPlans.PREMIUM
    const commitHash: string | string = COMMIT_HASH || ''
    const influxURL: string = INFLUX_URL || ''
    const influxToken: string = INFLUX_TOKEN || ''
    const influxOrg: string = INFLUX_ORG || ''
    const archivalChains: string[] = (ARCHIVAL_CHAINS || '').replace(' ', '').split(',')
    const alwaysRedirectToAltruists: boolean = ALWAYS_REDIRECT_TO_ALTRUISTS === 'true'

    if (aatPlan !== AatPlans.PREMIUM && !AatPlans.values.includes(aatPlan)) {
      throw new HttpErrors.InternalServerError('Unrecognized AAT Plan')
    }

    const dispatchers = dispatchURL.indexOf(',') ? dispatchURL.split(',') : [dispatchURL]

    const pocket = await getPocketInstance(dispatchers, clientPrivateKey)

    this.bind('clientPrivateKey').to(clientPrivateKey)
    this.bind('clientPassphrase').to(clientPassphrase)
    // I know what you're thinking: "why pass the dispatchURL raw string and not parsed as URL() array?".
    // Well doing so for some reason injects service nodes urls instead of the dispatcher urls and
    // those change per request, so let's keep it this way until loopback figures it out.
    this.bind('dispatchURL').to(dispatchURL)
    this.bind('relayer').to(pocket)
    this.bind('relayRetries').to(parseInt(relayRetries))
    this.bind('logger').to(logger)
    this.bind('defaultSyncAllowance').to(defaultSyncAllowance)
    this.bind('defaultLogLimitBlocks').to(defaultLogLimitBlocks)
    this.bind('alwaysRedirectToAltruists').to(alwaysRedirectToAltruists)

    // Load Redis for cache
    const redisEndpoint: string = REDIS_ENDPOINT || ''
    const redisPort: string = REDIS_PORT || ''

    const redisConfig = {
      host: redisEndpoint,
      port: parseInt(redisPort),
    }

    const redis =
      environment === 'production'
        ? new Redis.Cluster([redisConfig], {
            scaleReads: 'slave',
            redisOptions: {
              keyPrefix: `${commitHash}-`,
            },
          })
        : new Redis(redisConfig.port, redisConfig.host, {
            keyPrefix: `${commitHash}-`,
          })

    this.bind('redisInstance').to(redis)

    // Avoid updating the pocketjs instance right away on boot
    await redis.set(
      POCKET_JS_INSTANCE_TIMEOUT_KEY,
      'true',
      'EX',
      getRandomInt(POCKET_JS_TIMEOUT_MIN, POCKET_JS_TIMEOUT_MAX)
    )

    // New metrics postgres for error recording
    const psqlConnection: string = PSQL_CONNECTION || ''

    const pgPool = new pg.Pool({
      connectionString: psqlConnection,
      ssl: environment === 'production' || environment === 'staging' ? true : false,
    })

    this.bind('pgPool').to(pgPool)

    // Influx DB
    const influxBucket = environment === 'production' ? 'mainnetRelay' : 'mainnetRelayStaging'
    const influxClient = new InfluxDB({ url: influxURL, token: influxToken })
    const writeApi = influxClient.getWriteApi(influxOrg, influxBucket)

    this.bind('influxWriteAPI').to(writeApi)

    // Create a UID for this process
    const parts = [os.hostname(), process.pid, +new Date()]
    const hash = crypto.createHash('md5').update(parts.join(''))

    this.bind('processUID').to(hash.digest('hex'))
    this.bind('databaseEncryptionKey').to(databaseEncryptionKey)
    this.bind('aatPlan').to(aatPlan)
    this.bind('archivalChains').to(archivalChains)
  }
}
