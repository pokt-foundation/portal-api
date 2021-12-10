import RedisMock from 'ioredis-mock'
import rewiremock from 'rewiremock'
import { createRestAppClient, givenHttpServerConfig, Client } from '@loopback/testlab'
import { Pocket, Configuration, HttpRpcProvider } from '@pokt-network/pocket-js'

import { PocketGatewayApplication } from '../../src/application'
import { gatewayTestDB } from '../fixtures/test.datasource'

const DUMMY_ENV = {
  NODE_ENV: 'development',
  GATEWAY_CLIENT_PRIVATE_KEY: 'v3rys3cr3tk3yud0nt3venkn0w',
  GATEWAY_CLIENT_PASSPHRASE: 'v3rys3cr3tp4ssphr4ze',
  DATABASE_ENCRYPTION_KEY: '00000000000000000000000000000000',
  REDIS_ENDPOINT: 'cache:6379',
  REDIS_PORT: '6379',
  PG_CONNECTION: 'postgres://pguser:pgpassword@metricsdb:5432/gateway',
  PG_CERTIFICATE: 'PG_PRODUCTION_CERTIFICATE',
  PSQL_CONNECTION: 'postgres://pguser:pgpassword@metricsdb:5432/gateway',
  INFLUX_URL: 'http://influxdb:8086',
  INFLUX_TOKEN: 'abcde',
  INFLUX_ORG: 'myorg',
  DISPATCH_URL:
    'https://node1.mainnet.pokt.network,https://node2.mainnet.pokt.network,https://node3.mainnet.pokt.network,https://node4.mainnet.pokt.network,https://node5.mainnet.pokt.network,https://node6.mainnet.pokt.network,https://node7.mainnet.pokt.network,https://node8.mainnet.pokt.network,https://node9.mainnet.pokt.network,https://node10.mainnet.pokt.network,https://node11.mainnet.pokt.network,https://node12.mainnet.pokt.network,https://node13.mainnet.pokt.network,https://node14.mainnet.pokt.network,https://node15.mainnet.pokt.network,https://node16.mainnet.pokt.network,https://node17.mainnet.pokt.network,https://node18.mainnet.pokt.network,https://node19.mainnet.pokt.network,https://node20.mainnet.pokt.network',
  ALTRUISTS: `{
    "0001": "https://user:pass@backups.example.org:18081",
    "0003": "https://user:pass@backups.example.org:19650",
    "0004": "https://user:pass@backups.example.org:18552",
    "0005": "https://user:pass@backups.example.org:18553",
    "0009": "https://user:pass@backups.example.org:18554",
    "0010": "https://user:pass@backups.example.org:18552",
    "0021": "https://user:pass@backups.example.org:18545",
    "0022": "https://user:pass@backups.example.org:18545",
    "0023": "https://user:pass@backups.example.org:18557",
    "0024": "https://user:pass@backups.example.org:18548",
    "0025": "https://user:pass@backups.example.org:18555",
    "0026": "https://user:pass@backups.example.org:18556",
    "0027": "https://user:pass@backups.example.org:18546",
    "0028": "https://user:pass@backups.example.org:18545",
    "000A": "https://user:pass@backups.example.org:18553",
    "0041": "https://user:pass@backups.example.org:18082"
  }`,
  POCKET_SESSION_BLOCK_FREQUENCY: 4,
  POCKET_BLOCK_TIME: 1038000,
  POCKET_RELAY_RETRIES: '0',
  DEFAULT_SYNC_ALLOWANCE: 5,
  DEFAULT_LOG_LIMIT_BLOCKS: 10000,
  AAT_PLAN: 'freemium',
  REDIRECTS: [{ domain: 'ethereum.example.com', blockchain: 'ethereum-mainnet', loadBalancerID: '1234567890' }],
  COMMIT_HASH: '1234',
  ARCHIVAL_CHAINS: '1234,4567',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  AWS_REGION: 'test',
}

export async function setupApplication(pocket?: typeof Pocket, envs?: object): Promise<AppWithClient> {
  const restConfig = givenHttpServerConfig()

  const appWithMock = rewiremock.proxy(() => require('../../src/application'), {
    ioredis: RedisMock,
    ...(pocket && { '@pokt-network/pocket-js': { Pocket: pocket, Configuration, HttpRpcProvider } }),
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

  const client = createRestAppClient(app)

  return { app, client }
}

export interface AppWithClient {
  app: PocketGatewayApplication
  client: Client
}
