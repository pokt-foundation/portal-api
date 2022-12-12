import { Relayer } from '@pokt-foundation/pocketjs-relayer'
// import Redis from 'ioredis-mock'
import rewiremock from 'rewiremock'
import { createRestAppClient, givenHttpServerConfig, Client } from '@loopback/testlab'

import { PocketGatewayApplication } from '../../src/application'
import { gatewayTestDB } from '../fixtures/test.datasource'
const Redis = require('ioredis-mock')

export const DUMMY_ENV = {
  NODE_ENV: 'development',
  GATEWAY_CLIENT_PRIVATE_KEY: 'v3rys3cr3tk3yud0nt3venkn0w',
  GATEWAY_CLIENT_PASSPHRASE: 'v3rys3cr3tp4ssphr4ze',
  DATABASE_ENCRYPTION_KEY: '00000000000000000000000000000000',
  REDIS_PORT: '6379',
  REMOTE_REDIS_ENDPOINT: 'cache:6379',
  LOCAL_REDIS_ENDPOINT: 'local-cache:6380',
  PSQL_CONNECTION: 'postgres://pguser:pgpassword@metricsdb:5432/gateway',
  PSQL_CERTIFICATE: 'PG_PRODUCTION_CERTIFICATE',
  INFLUX_URLS: ['http://influxdb:8086'],
  INFLUX_TOKENS: ['abcde'],
  INFLUX_ORGS: ['myorg'],
  DISPATCH_URL: 'https://node1.dispatcher.pokt.network/',
  POCKET_SESSION_BLOCK_FREQUENCY: 4,
  POCKET_BLOCK_TIME: 1038000,
  POCKET_RELAY_RETRIES: '0',
  DEFAULT_SYNC_ALLOWANCE: 5,
  DEFAULT_LOG_LIMIT_BLOCKS: 10000,
  AAT_PLAN: 'freemium',
  ARCHIVAL_CHAINS: '1234,4567',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  AWS_REGION: 'test',
  BLOCKED_ADDRESSES_URL: 'https://blocked.addresses',
  RATE_LIMITER_URL: 'https://rate.limiter',
  RELAY_SECURITY_URL: '',
  RATE_LIMITER_TOKEN: 'rate-limiter-token',
  ALTRUIST_ONLY_CHAINS: '',
  GATEWAY_HOST: 'localhost',
}

export async function setupApplication(pocket?: Relayer, envs?: object): Promise<AppWithClient> {
  const restConfig = givenHttpServerConfig()

  const appWithMock = rewiremock.proxy(() => require('../../src/application'), {
    ioredis: Redis,
    ...(pocket && { './config/pocket-config': { getPocketInstance: () => pocket } }),
  })

  const appEnvs = envs ? { ...DUMMY_ENV, ...envs } : { ...DUMMY_ENV }

  // Add all envs to the process.env so they fail if they're not properly set by the environment observer check
  for (const [name, value] of Object.entries(appEnvs)) {
    process.env[name] = value as string
  }

  const app = new appWithMock.PocketGatewayApplication({
    rest: restConfig,
    env: {
      load: true,
    },
  })

  await app.boot()

  app.dataSource(gatewayTestDB)

  await app.start()
  await app.loadPocket()

  // Redis mock persist data between instances as long as they share the same host/port
  // so they need to be cleaned each time.
  let mock: typeof Redis

  // remote redis mock
  mock = new Redis(parseInt(DUMMY_ENV.REDIS_PORT), DUMMY_ENV.REMOTE_REDIS_ENDPOINT)

  await mock.flushall()

  // local redis mock
  mock = new Redis(parseInt(DUMMY_ENV.REDIS_PORT), DUMMY_ENV.LOCAL_REDIS_ENDPOINT)

  await mock.flushall()

  const client = createRestAppClient(app)

  return { app, client }
}

export interface AppWithClient {
  app: PocketGatewayApplication
  client: Client
}
