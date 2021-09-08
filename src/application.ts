import { BootMixin } from '@loopback/boot'
import { ApplicationConfig } from '@loopback/core'
import { RepositoryMixin } from '@loopback/repository'
import { RestApplication, HttpErrors } from '@loopback/rest'
import { DEFAULT_POCKET_CONFIG } from './config/pocket-config'
import { ServiceMixin } from '@loopback/service-proxy'
import { GatewaySequence } from './sequence'
import { Account } from '@pokt-network/pocket-js/dist/keybase/models/account'

import path from 'path'
import AatPlans from './config/aat-plans.json'

const logger = require('./services/logger')

import { Pocket, Configuration, HttpRpcProvider } from '@pokt-network/pocket-js'

import Redis from 'ioredis'
import crypto from 'crypto'
import os from 'os'
import process from 'process'
import pg from 'pg'

require('log-timestamp')
require('dotenv').config()

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
      ALTRUISTS,
      POCKET_SESSION_BLOCK_FREQUENCY,
      POCKET_BLOCK_TIME,
      POCKET_RELAY_RETRIES,
      DEFAULT_SYNC_ALLOWANCE,
      DEFAULT_LOG_LIMIT_BLOCKS,
      AAT_PLAN,
      REDIRECTS,
    } = await this.get('configuration.environment.values')

    const environment: string = NODE_ENV || 'production'
    const dispatchURL: string = DISPATCH_URL || ''
    const altruists: string = ALTRUISTS || ''
    const clientPrivateKey: string = GATEWAY_CLIENT_PRIVATE_KEY || ''
    const clientPassphrase: string = GATEWAY_CLIENT_PASSPHRASE || ''
    const pocketSessionBlockFrequency: string = POCKET_SESSION_BLOCK_FREQUENCY || ''
    const pocketBlockTime: string = POCKET_BLOCK_TIME || ''
    const relayRetries: string = POCKET_RELAY_RETRIES || ''
    const databaseEncryptionKey: string = DATABASE_ENCRYPTION_KEY || ''
    const defaultSyncAllowance: number = parseInt(DEFAULT_SYNC_ALLOWANCE) || -1
    const defaultLogLimitBlocks: number = parseInt(DEFAULT_LOG_LIMIT_BLOCKS) || 10000
    const aatPlan = AAT_PLAN || AatPlans.PREMIUM
    const redirects: string | object[] = REDIRECTS || ''

    if (!dispatchURL) {
      throw new HttpErrors.InternalServerError('DISPATCH_URL required in ENV')
    }
    if (!altruists) {
      throw new HttpErrors.InternalServerError('ALTRUISTS required in ENV')
    }
    if (!clientPrivateKey) {
      throw new HttpErrors.InternalServerError('GATEWAY_CLIENT_PRIVATE_KEY required in ENV')
    }
    if (!clientPassphrase) {
      throw new HttpErrors.InternalServerError('GATEWAY_CLIENT_PASSPHRASE required in ENV')
    }
    if (!pocketSessionBlockFrequency || pocketSessionBlockFrequency === '') {
      throw new HttpErrors.InternalServerError('POCKET_SESSION_BLOCK_FREQUENCY required in ENV')
    }
    if (!pocketBlockTime || pocketBlockTime === '') {
      throw new HttpErrors.InternalServerError('POCKET_BLOCK_TIME required in ENV')
    }
    if (!databaseEncryptionKey) {
      throw new HttpErrors.InternalServerError('DATABASE_ENCRYPTION_KEY required in ENV')
    }
    if (defaultSyncAllowance < 0) {
      throw new HttpErrors.InternalServerError('DEFAULT_SYNC_ALLOWANCE required in ENV')
    }
    if (defaultLogLimitBlocks < 0) {
      throw new HttpErrors.InternalServerError('DEFAULT_LOG_LIMIT_BLOCKS required in ENV')
    }
    if (aatPlan !== AatPlans.PREMIUM && !AatPlans.values.includes(aatPlan)) {
      throw new HttpErrors.InternalServerError('Unrecognized AAT Plan')
    }
    if (!redirects) {
      throw new HttpErrors.InternalServerError('REDIRECTS required in ENV')
    }

    const dispatchers = []

    if (dispatchURL.indexOf(',')) {
      const dispatcherArray = dispatchURL.split(',')

      dispatcherArray.forEach(function (dispatcher) {
        dispatchers.push(new URL(dispatcher))
      })
    } else {
      dispatchers.push(new URL(dispatchURL))
    }

    const configuration = new Configuration(
      DEFAULT_POCKET_CONFIG.maxDispatchers,
      DEFAULT_POCKET_CONFIG.maxSessions,
      DEFAULT_POCKET_CONFIG.consensusNodeCount,
      DEFAULT_POCKET_CONFIG.requestTimeout,
      DEFAULT_POCKET_CONFIG.acceptDisputedResponses,
      parseInt(pocketSessionBlockFrequency),
      parseInt(pocketBlockTime),
      DEFAULT_POCKET_CONFIG.validateRelayResponses,
      DEFAULT_POCKET_CONFIG.rejectSelfSignedCertificates,
      DEFAULT_POCKET_CONFIG.useLegacyTxCodec
    )
    const rpcProvider = new HttpRpcProvider(dispatchers[0])
    const pocket = new Pocket(dispatchers, rpcProvider, configuration)

    // Bind to application context for shared re-use
    this.bind('pocketInstance').to(pocket)
    this.bind('pocketConfiguration').to(configuration)
    this.bind('relayRetries').to(parseInt(relayRetries))
    this.bind('altruists').to(altruists)
    this.bind('logger').to(logger)
    this.bind('defaultSyncAllowance').to(defaultSyncAllowance)
    this.bind('defaultLogLimitBlocks').to(defaultLogLimitBlocks)
    this.bind('redirects').to(redirects)

    // Unlock primary client account for relay signing
    try {
      const importAccount = await pocket.keybase.importAccount(Buffer.from(clientPrivateKey, 'hex'), clientPassphrase)

      if (importAccount instanceof Account) {
        await pocket.keybase.unlockAccount(importAccount.addressHex, clientPassphrase, 0)
      }
    } catch (e) {
      logger.log('error', e)
      throw new HttpErrors.InternalServerError('Unable to import or unlock base client account')
    }

    // Load Redis for cache
    const redisEndpoint: string = REDIS_ENDPOINT || ''
    const redisPort: string = REDIS_PORT || ''

    if (!redisEndpoint) {
      throw new HttpErrors.InternalServerError('REDIS_ENDPOINT required in ENV')
    }
    if (!redisPort) {
      throw new HttpErrors.InternalServerError('REDIS_PORT required in ENV')
    }
    const redis = new Redis(parseInt(redisPort), redisEndpoint)

    this.bind('redisInstance').to(redis)

    // New metrics postgres for error recording
    const psqlConnection: string = PSQL_CONNECTION || ''

    if (!psqlConnection) {
      throw new HttpErrors.InternalServerError('PSQL_CONNECTION required in ENV')
    }
    const psqlConfig = {
      connectionString: psqlConnection,
      ssl: environment === 'production' || environment === 'staging' ? true : false,
    }
    const pgPool = new pg.Pool(psqlConfig)

    this.bind('pgPool').to(pgPool)

    this.bind('databaseEncryptionKey').to(databaseEncryptionKey)
    this.bind('aatPlan').to(aatPlan)

    // Create a UID for this process
    const parts = [os.hostname(), process.pid, +new Date()]
    const hash = crypto.createHash('md5').update(parts.join(''))

    this.bind('processUID').to(hash.digest('hex'))
  }
}
