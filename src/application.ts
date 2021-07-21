import { BootMixin } from '@loopback/boot'
import { ApplicationConfig } from '@loopback/core'
import { RepositoryMixin } from '@loopback/repository'
import { RestApplication, HttpErrors } from '@loopback/rest'
import { ServiceMixin } from '@loopback/service-proxy'
import { GatewaySequence } from './sequence'
import { Account } from '@pokt-network/pocket-js/dist/keybase/models/account'

import path from 'path'
import AatPlans from './config/aat-plans.json'

const logger = require('./services/logger')

const pocketJS = require('@pokt-network/pocket-js')
const { Pocket, Configuration, HttpRpcProvider } = pocketJS

import Redis from 'ioredis'
import crypto from 'crypto'
import os from 'os'
import process from 'process'
import pg from 'pg'
import got from 'got'

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
  }

  async loadPocket(): Promise<void> {
    // Requirements; for Production these are stored in GitHub repo secrets
    //
    // For Dev, you need to pass them in via .env file
    const environment: string = process.env.NODE_ENV || 'production'

    logger.log('info', 'Environment: ' + environment)

    const dispatchURL: string = process.env.DISPATCH_URL || ''
    const altruists: string = process.env.ALTRUISTS || ''
    const clientPrivateKey: string = process.env.GATEWAY_CLIENT_PRIVATE_KEY || ''
    const clientPassphrase: string = process.env.GATEWAY_CLIENT_PASSPHRASE || ''
    const pocketSessionBlockFrequency: string = process.env.POCKET_SESSION_BLOCK_FREQUENCY || ''
    const pocketBlockTime: string = process.env.POCKET_BLOCK_TIME || ''
    const relayRetries: string = process.env.POCKET_RELAY_RETRIES || ''
    const databaseEncryptionKey: string = process.env.DATABASE_ENCRYPTION_KEY || ''
    const defaultSyncAllowance: number = parseInt(process.env.DEFAULT_SYNC_ALLOWANCE) || -1
    const aatPlan = process.env.AAT_PLAN || AatPlans.PREMIUM
    const redirects = process.env.REDIRECTS || '' // Can be empty

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
    if (aatPlan !== AatPlans.PREMIUM && !AatPlans.values.includes(aatPlan)) {
      throw new HttpErrors.InternalServerError('Unrecognized AAT Plan')
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
      50,
      100000,
      0,
      120000,
      false,
      parseInt(pocketSessionBlockFrequency),
      parseInt(pocketBlockTime),
      undefined,
      undefined,
      false
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
    const redisEndpoint: string = process.env.REDIS_ENDPOINT || ''
    const redisPort: string = process.env.REDIS_PORT || ''

    if (!redisEndpoint) {
      throw new HttpErrors.InternalServerError('REDIS_ENDPOINT required in ENV')
    }
    if (!redisPort) {
      throw new HttpErrors.InternalServerError('REDIS_PORT required in ENV')
    }
    const redis = new Redis(parseInt(redisPort), redisEndpoint)

    this.bind('redisInstance').to(redis)

    // Load Postgres for TimescaleDB metrics
    const pgConnection: string = process.env.PG_CONNECTION || ''
    const pgCertificate: string = process.env.PG_CERTIFICATE || ''

    if (!pgConnection) {
      throw new HttpErrors.InternalServerError('PG_CONNECTION required in ENV')
    }

    if (!pgCertificate && environment !== 'development') {
      throw new HttpErrors.InternalServerError('PG_CERTIFICATE required in ENV')
    }

    // Pull public certificate from Redis or s3 if not there
    const cachedCertificate = await redis.get('timescaleDBCertificate')
    let publicCertificate

    if (environment === 'production') {
      if (!cachedCertificate) {
        try {
          const s3Certificate = await got(pgCertificate)

          publicCertificate = s3Certificate.body
        } catch (e) {
          throw new HttpErrors.InternalServerError('Invalid Certificate')
        }
        await redis.set('timescaleDBCertificate', publicCertificate, 'EX', 600)
      } else {
        publicCertificate = cachedCertificate
      }
    }

    const ssl =
      environment === 'production'
        ? {
            rejectUnauthorized: false,
            ca: publicCertificate,
          }
        : false

    const pgConfig = {
      connectionString: pgConnection,
      ssl,
    }
    const pgPool = new pg.Pool(pgConfig)

    this.bind('pgPool').to(pgPool)
    this.bind('databaseEncryptionKey').to(databaseEncryptionKey)
    this.bind('aatPlan').to(aatPlan)

    // Create a UID for this process
    const parts = [os.hostname(), process.pid, +new Date()]
    const hash = crypto.createHash('md5').update(parts.join(''))

    this.bind('processUID').to(hash.digest('hex'))
  }
}
