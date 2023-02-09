import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { Encryptor } from 'strong-cryptor'
import { Client, sinon, expect } from '@loopback/testlab'
import { PocketGatewayApplication } from '../..'
import { ApplicationsRepository } from '../../src/repositories/applications.repository'
import { BlockchainsRepository } from '../../src/repositories/blockchains.repository'
import { LoadBalancersRepository } from '../../src/repositories/load-balancers.repository'
import { gatewayTestDB } from '../fixtures/test.datasource'
import { MockRelayResponse, PocketMock } from '../mocks/pocketjs'
import { setupApplication } from './test-helper'

const logger = require('../../src/services/logger')

// Must be the same one from the test environment on ./test-helper.ts
const DB_ENCRYPTION_KEY = '00000000000000000000000000000000'

const APPLICATION = {
  id: 'sd9fj31d714kgos42e68f9gh',
  name: 'Test',
  owner: 'test',
  publicPocketAccount: {
    address: 'zbsh21mrn411umuyv2xh7e85cme3tf7er1assuop',
    publicKey: '9c1osndf3hj5wvkgi5ounpqwdhzcyzfy0qrk6z7o',
  },
  freeTierApplicationAccount: {
    address: 'qglysyptu3ga0tq8qfi4pxvdxo1cg629oh6s8uom',
    publicKey: '74xyfz6bey09pmtayj0ma7vvqq15cb8y7w7vv4jfrf1tjsh7o6fppk0xbw4zlcbr',
    privateKey: '',
  },
  gatewaySettings: {
    secretKey: 'y1lhuxbpo7u3hvxzqvesbx7jcjdczw3j',
    secretKeyRequired: false,
    whitelistBlockchains: [],
    whitelistOrigins: [],
    whitelistUserAgents: [],
    whitelistContracts: [],
    whitelistMethods: [],
  },
  gatewayAAT: {
    version: '0.0.1',
    clientPublicKey: 'f8sqxrxhzjt59mk1vmm4v3r1l62rf1xwt5e6yrc3vaktnfvmf0x9ggs8jkjxlp4c',
    applicationPublicKey: '0m8nn4vfh6n3kk8mynbfphm7j4np8kgi14ul0tcy4chdx4i7v6uhjetb1q8eo5fo',
    applicationSignature:
      '87ux2poyr319tp9un97nflybr3l66umrjf4p5ifmwb6aq3frpgl9mqolikt1xcpu4d1o321pbm0edizck8tsnr8e8fdmazxskr9c5zx0ab9z1so2g8x29xazaffse8c0',
  },
  url: 'https://test-portal-url.com',
}

const GIGASTAKE_LEADER_IDS = {
  app: 'dofwms0cosmasiqqoadldfis',
  lb: 'hovj6nfix1nr0dknadwawawa',
}
const GIGASTAKE_FOLLOWER_IDS = {
  app: 'asassd9sd0ffjdcusue2fidi',
  lb: 'df9f9f9gdklkwotn5o3ixuso',
}

const RATE_LIMITED_APPLICATION = { ...APPLICATION, id: 'rateLimitedApp123' }

const RATE_LIMITED_LB_ID = {
  app: RATE_LIMITED_APPLICATION.id,
  lb: '1bc8y2dp3h7c38vbybeeaf7b',
}

// Follower app that has restricted gateway settings
const GIGASTAKE_FOLLOWER_IDS_WITH_RESTRICTIONS = {
  app: '5ifmwb6aq3frpgl9mqolike1',
  lb: '0ab9z1so2g8x29xazaffse8c',
}

// Might not actually reflect real-world values
const BLOCKCHAINS = [
  {
    id: '0001',
    ticker: 'POKT',
    networkID: 'mainnet',
    network: 'POKT-mainnet',
    description: 'Pocket Network Mainnet',
    index: 1,
    blockchain: 'mainnet',
    blockchainAliases: ['mainnet'],
    active: true,
    enforceResult: 'JSON',
    nodeCount: 1,
    chainID: '21',
    chainIDCheck: '{}',
    path: '',
    altruist: 'https://user:pass@backups.example.org:18081',
    redirects: [
      {
        alias: 'mainnet',
        domain: 'mainnet.example.com',
        loadBalancerID: GIGASTAKE_LEADER_IDS.lb,
      },
    ],
  },
  {
    id: '0021',
    ticker: 'ETH',
    networkID: '1',
    network: 'ETH-1',
    description: 'Ethereum Mainnet',
    index: 2,
    blockchain: 'eth-mainnet',
    blockchainAliases: ['eth-mainnet'],
    active: true,
    enforceResult: 'JSON',
    nodeCount: 1,
    chainID: '100',
    chainIDCheck: '{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}',
    path: '',
    syncCheckOptions: {
      body: '{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}',
      resultKey: 'result',
      allowance: 5,
      path: '',
    },
    altruist: 'https://user:pass@backups.example.org:18545',
    redirects: [
      {
        alias: 'eth-mainnet',
        domain: 'eth-mainnet',
        loadBalancerID: GIGASTAKE_LEADER_IDS.lb,
      },
    ],
  },
  {
    id: '0040',
    ticker: 'ETHS',
    networkID: '1',
    network: 'ETH-1S',
    description: 'Ethereum Mainnet String',
    index: 3,
    blockchain: 'eth-mainnet-string',
    blockchainAliases: ['eth-mainnet-string'],
    active: true,
    enforceResult: 'JSON',
    nodeCount: 1,
    chainID: '64',
    chainIDCheck: '',
    path: '',
    syncCheckOptions: {
      body: '{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}',
      resultKey: 'result',
      allowance: 5,
    },
  },
  {
    id: '0041',
    ticker: 'ETHX',
    networkID: '1',
    network: 'ETH-2',
    description: 'Ethereum Mainnet X',
    index: 2,
    blockchain: 'eth-mainnet-x',
    blockchainAliases: ['eth-mainnet-x'],
    active: true,
    enforceResult: 'JSON',
    nodeCount: 1,
    chainID: '137',
    chainIDCheck: '',
    path: '',
    syncCheckOptions: {
      body: '{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}',
      resultKey: 'result',
      allowance: 5,
    },
    altruist: 'https://user:pass@backups.example.org:18082',
    redirects: [
      {
        alias: 'eth-mainnet-x',
        domain: 'eth-mainnet-x',
        loadBalancerID: GIGASTAKE_LEADER_IDS.lb,
      },
    ],
  },
]

const APPLICATIONS = [
  APPLICATION,
  { ...APPLICATION, id: 'fg5fdj31d714kdif9g9fe68f' },
  { ...APPLICATION, id: 'cienuohoddigue4w232s9rja' },
  { ...APPLICATION, id: GIGASTAKE_LEADER_IDS.app },
  { ...APPLICATION, id: GIGASTAKE_FOLLOWER_IDS.app },
]

const LOAD_BALANCERS = [
  {
    id: 'gt4a1s9rfrebaf8g31bsdc04',
    user: 'test@test.com',
    name: 'test load balancer',
    requestTimeout: '5000',
    applicationIDs: APPLICATIONS.map((app) => app.id),
  },
  {
    id: 'gt4a1s9rfrebaf8g31bsdc05',
    user: 'test@test.com',
    name: 'test load balancer sticky rpc',
    requestTimeout: '5000',
    applicationIDs: APPLICATIONS.map((app) => app.id),
    logLimitBlocks: 25000,
    stickinessOptions: {
      stickiness: true,
      duration: 300,
      useRPCID: true,
      relaysLimit: 1e6,
      rpcIDThreshold: 2,
    },
  },
  {
    id: 'df9gjsjg43db9fsajfjg93fk',
    user: 'test@test.com',
    name: 'test load balancer sticky prefix',
    requestTimeout: '5000',
    applicationIDs: APPLICATIONS.map((app) => app.id),
    logLimitBlocks: 25000,
    stickinessOptions: {
      stickiness: true,
      duration: 300,
      useRPCID: false,
      relaysLimit: 1e6,
    },
  },
  {
    id: 'd8ejd7834ht9d9sj345gfsoa',
    user: 'test@test.com',
    name: 'test load balancer sticky prefix with whitelist',
    requestTimeout: '5000',
    applicationIDs: APPLICATIONS.map((app) => app.id),
    logLimitBlocks: 25000,
    stickinessOptions: {
      stickiness: true,
      duration: 300,
      useRPCID: false,
      relaysLimit: 1e6,
      stickyOrigins: ['localhost'],
    },
  },
  {
    id: GIGASTAKE_LEADER_IDS.lb,
    user: 'test@test.com',
    name: 'gigastaked lb - leader',
    requestTimeout: '5000',
    applicationIDs: [GIGASTAKE_LEADER_IDS.app],
    logLimitBlocks: 25000,
    stickinessOptions: {
      stickiness: true,
      duration: 300,
      useRPCID: false,
      relaysLimit: 1e6,
      stickyOrigins: ['localhost'],
    },
  },
  {
    id: GIGASTAKE_FOLLOWER_IDS.lb,
    user: 'test@test.com',
    name: 'gigastaked lb - follower',
    requestTimeout: '5000',
    applicationIDs: [GIGASTAKE_FOLLOWER_IDS.app],
    logLimitBlocks: 25000,
    gigastakeRedirect: true,
    stickinessOptions: {
      stickiness: true,
      duration: 300,
      useRPCID: false,
      relaysLimit: 1e6,
      stickyOrigins: ['localhost'],
    },
  },
  {
    id: GIGASTAKE_FOLLOWER_IDS_WITH_RESTRICTIONS.lb,
    user: 'test@test.com',
    name: 'gigastaked lb - follower',
    requestTimeout: '5000',
    applicationIDs: [GIGASTAKE_FOLLOWER_IDS_WITH_RESTRICTIONS.app],
    logLimitBlocks: 25000,
    gigastakeRedirect: true,
    stickinessOptions: {
      stickiness: true,
      duration: 300,
      useRPCID: false,
      relaysLimit: 1e6,
      stickyOrigins: ['localhost'],
    },
  },
  {
    id: RATE_LIMITED_LB_ID.lb,
    user: 'test@test.com',
    name: 'rate limited lb',
    requestTimeout: '5000',
    applicationIDs: [RATE_LIMITED_LB_ID.app],
    logLimitBlocks: 25000,
    gigastakeRedirect: false,
    stickinessOptions: {
      stickiness: true,
      duration: 300,
      useRPCID: false,
      relaysLimit: 1e6,
      stickyOrigins: ['localhost'],
    },
  },
]

describe('V1 controller (acceptance)', () => {
  let app: PocketGatewayApplication
  let client: Client
  let blockchainsRepository: BlockchainsRepository
  let applicationsRepository: ApplicationsRepository
  let loadBalancersRepository: LoadBalancersRepository
  let pocketMock: PocketMock
  let relayResponses: Record<string, MockRelayResponse | MockRelayResponse[]>
  let axiosMock: MockAdapter

  before('setupApplication', async () => {
    blockchainsRepository = new BlockchainsRepository(gatewayTestDB)
    applicationsRepository = new ApplicationsRepository(gatewayTestDB)
    loadBalancersRepository = new LoadBalancersRepository(gatewayTestDB)

    axiosMock = new MockAdapter(axios)
    axiosMock.onPost('https://user:pass@backups.example.org:18081/v1/query/node').reply(200, {
      service_url: 'https://localhost:443',
    })

    axiosMock.onGet('https://blocked.addresses').reply(200, {
      blockedAddresses: ['0x5d13399e7a59941734900157381e2d0b9d29c971', '0xea674fdde714fd979de3edf0f56aa9716b898ec8'],
    })

    axiosMock.onGet('https://rate.limiter').reply(200, {
      applicationIDs: ['rateLimitedApp123'],
    })

    axiosMock.onGet(process.env.PHD_BASE_URL).reply(200)
  })

  after(async () => {
    await app.stop()
  })

  beforeEach(async () => {
    relayResponses = {
      '{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}': '{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}',
      '{"method":"eth_getLogs","params":[{"fromBlock":"0x9c5bb6","toBlock":"0x9c5bb6","address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff"}],"id":1,"jsonrpc":"2.0"}':
        '{"jsonrpc":"2.0","id":1,"result":[{"address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff","blockHash":"0x2ad90e24266edd835bb03071c0c0b58ee8356c2feb4576d15b3c2c2b2ef319c5","blockNumber":"0xc5bdc9","data":"0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000767fe9edc9e0df98e07454847909b5e959d7ca0e0000000000000000000000000000000000000000000000019274b259f653fc110000000000000000000000000000000000000000000000104bf2ffa4dcbf8de5","logIndex":"0x4c","removed":false,"topics":["0x0f6672f78a59ba8e5e5b5d38df3ebc67f3c792e2c9259b8d97d7f00dd78ba1b3","0x000000000000000000000000e5feeac09d36b18b3fa757e5cf3f8da6b8e27f4c"],"transactionHash":"0x14430f1e344b5f95ea68a5f4c0538fc732cc97efdc68f6ee0ba20e2c633542f6","transactionIndex":"0x1a"}]}',
      '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["latest",false],"id":1}':
        '{"jsonrpc":"2.0","id":1,"result":{"number":"0xed14f2","totalDifficulty":"0xc70d815d562d3cfa955"}}',
    }

    axiosMock
      .onPost(BLOCKCHAINS['0041']?.altruist, { method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .reply(200, relayResponses['{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}'])

    axiosMock
      .onPost(BLOCKCHAINS['0021']?.altruist, { method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .reply(200, relayResponses['{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}'])

    pocketMock = new PocketMock(undefined, undefined, undefined)
    pocketMock.relayResponse = relayResponses

    await loadBalancersRepository.createAll(LOAD_BALANCERS)
    await blockchainsRepository.createAll(BLOCKCHAINS)
    await applicationsRepository.createAll(APPLICATIONS)
    await applicationsRepository.create(RATE_LIMITED_APPLICATION)
  })

  afterEach(async () => {
    sinon.restore()

    await loadBalancersRepository.deleteAll()
    await blockchainsRepository.deleteAll()
    await applicationsRepository.deleteAll()
  })

  after(async () => {
    axiosMock.restore()
  })

  it('Fetches all data from Pocket HTTP DB, invokes GET /v1/{appId} and successfully relays a request', async () => {
    const pocket = pocketMock.object()

    relayResponses['{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}'] =
      '{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}'
    ;({ app, client } = await setupApplication(pocket))

    axiosMock.onGet(`${process.env.PHD_BASE_URL}/application/${APPLICATION.id}`).replyOnce(200, APPLICATION)
    axiosMock.onGet(`${process.env.PHD_BASE_URL}/blockchain`).replyOnce(200, BLOCKCHAINS)
    axiosMock.onGet(`${process.env.PHD_BASE_URL}/load_balancer/${GIGASTAKE_LEADER_IDS.lb}`).replyOnce(
      200,
      LOAD_BALANCERS.find(({ id }) => id === GIGASTAKE_LEADER_IDS.lb)
    )
    axiosMock.onGet(`${process.env.PHD_BASE_URL}/application/${GIGASTAKE_LEADER_IDS.app}`).replyOnce(
      200,
      APPLICATIONS.find(({ id }) => id === GIGASTAKE_LEADER_IDS.app)
    )

    const response = await client
      .post(`/v1/${APPLICATION.id}`)
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .expect(200)

    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
    expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
  })

  it('invokes GET /v1/{appId} and successfully relays a request', async () => {
    const pocket = pocketMock.object()

    relayResponses['{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}'] =
      '{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}'
    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post('/v1/sd9fj31d714kgos42e68f9gh')
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .expect(200)

    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
    expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
  })

  it('returns 404 when no app is found', async () => {
    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    await applicationsRepository.deleteAll()

    const res = await client
      .post('/v1/notfoundapp')
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet')
      .expect(200)

    expect(res.body).to.have.property('error')
    expect(res.body.error.message).to.startWith('Application not found')
  })

  it('returns 404 when the specified blockchain is not found', async () => {
    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    await blockchainsRepository.deleteAll()

    const res = await client
      .post('/v1/sd9fj31d714kgos42e68f9gh')
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'invalid-blockchain')
      .expect(200)

    expect(res.body).to.have.property('error')
    expect(res.body.error.message).to.startWith('Incorrect blockchain')
  })

  it('internally performs successful sync check/chain check', async () => {
    relayResponses['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
    relayResponses['{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}'] =
      '{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}'

    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post('/v1/sd9fj31d714kgos42e68f9gh')
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet')
      .expect(200)

    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
    expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
  })

  it('fails on request with invalid authorization header', async () => {
    const encryptor = new Encryptor({ key: DB_ENCRYPTION_KEY })
    const key = 'encrypt123456789120encrypt123456789120'
    const encryptedKey = encryptor.encrypt(key)

    const appWithSecurity = { ...APPLICATION, id: 'secretAppID12345' }

    appWithSecurity.gatewaySettings = {
      secretKey: encryptedKey,
      secretKeyRequired: true,
      whitelistBlockchains: [],
      whitelistOrigins: [],
      whitelistUserAgents: [],
      whitelistContracts: [],
      whitelistMethods: [],
    }

    const dbApp = await applicationsRepository.create(appWithSecurity)

    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post(`/v1/${dbApp.id}`)
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet')
      .set('authorization', 'invalid key')
      .expect(200)

    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.have.property('error')
    expect(response.body.error.message).to.be.equal('SecretKey does not match')
  })

  it('fails on request with invalid origin', async () => {
    const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

    appWithSecurity.gatewaySettings = {
      secretKey: '',
      secretKeyRequired: false,
      whitelistBlockchains: [],
      whitelistOrigins: ['unlocalhost'],
      whitelistUserAgents: [],
      whitelistContracts: [],
      whitelistMethods: [],
    }

    const dbApp = await applicationsRepository.create(appWithSecurity)

    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post(`/v1/${dbApp.id}`)
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet')
      .set('origin', 'localhost')
      .expect(200)

    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.have.property('error')
    expect(response.body.error.message).to.startWith('Whitelist Origin check failed')
  })

  it('fails on gigastake relay with invalid secret key', async () => {
    const appWithSecurity = { ...APPLICATION, id: GIGASTAKE_FOLLOWER_IDS_WITH_RESTRICTIONS.app }

    appWithSecurity.gatewaySettings = {
      secretKey: 'securekey',
      secretKeyRequired: true,
      whitelistBlockchains: [],
      whitelistOrigins: [],
      whitelistUserAgents: [],
      whitelistContracts: [],
      whitelistMethods: [],
    }

    await applicationsRepository.create(appWithSecurity)

    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post(`/v1/lb/${GIGASTAKE_FOLLOWER_IDS_WITH_RESTRICTIONS.lb}`)
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .expect(200)

    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.have.property('error')
    expect(response.body.error.message).to.startWith('SecretKey does not match')
  })

  it('fails on gigastake relay with invalid origin', async () => {
    const appWithSecurity = { ...APPLICATION, id: GIGASTAKE_FOLLOWER_IDS_WITH_RESTRICTIONS.app }

    appWithSecurity.gatewaySettings = {
      secretKey: '',
      secretKeyRequired: false,
      whitelistBlockchains: [],
      whitelistOrigins: ['https://pokt.network'],
      whitelistUserAgents: [],
      whitelistContracts: [],
      whitelistMethods: [],
    }

    await applicationsRepository.create(appWithSecurity)

    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post(`/v1/lb/${GIGASTAKE_FOLLOWER_IDS_WITH_RESTRICTIONS.lb}`)
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .set('origin', 'https://poketo.network')
      .expect(200)

    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.have.property('error')
    expect(response.body.error.message).to.startWith('Whitelist Origin check failed')
  })

  it('fails on gigastake relay with invalid user agent', async () => {
    const appWithSecurity = { ...APPLICATION, id: GIGASTAKE_FOLLOWER_IDS_WITH_RESTRICTIONS.app }

    appWithSecurity.gatewaySettings = {
      secretKey: '',
      secretKeyRequired: false,
      whitelistBlockchains: [],
      whitelistOrigins: [],
      whitelistUserAgents: ['Mozilla/5.0'],
      whitelistContracts: [],
      whitelistMethods: [],
    }

    await applicationsRepository.create(appWithSecurity)

    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post(`/v1/lb/${GIGASTAKE_FOLLOWER_IDS_WITH_RESTRICTIONS.lb}`)
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .set('user-agent', 'Chrome')
      .expect(200)

    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.have.property('error')
    expect(response.body.error.message).to.startWith('Whitelist User Agent check failed')
  })

  it('success relay with correct secret key, origin and userAgent security', async () => {
    const appID = 'applicationID12235'
    const encryptor = new Encryptor({ key: DB_ENCRYPTION_KEY })
    const key = 'encrypt123456789120encrypt123456789120'
    const encryptedKey = encryptor.encrypt(key)

    const appWithSecurity = { ...APPLICATION, id: appID }

    appWithSecurity.gatewaySettings = {
      secretKey: encryptedKey,
      secretKeyRequired: true,
      whitelistBlockchains: [],
      whitelistOrigins: ['unlocalhost'],
      whitelistUserAgents: ['Mozilla/5.0'],
      whitelistContracts: [],
      whitelistMethods: [],
    }

    await applicationsRepository.create(appWithSecurity)

    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post(`/v1/${appID}`)
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .set('origin', 'unlocalhost')
      .set('authorization', `Basic ${Buffer.from(':' + key).toString('base64')}`)
      .set('user-agent', 'Mozilla/5.0')
      .expect(200)

    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
    expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
  })

  it('performs a failed request returning error', async () => {
    pocketMock.fail = true
    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post('/v1/sd9fj31d714kgos42e68f9gh')
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-string') // blockchain without altruist
      .expect(200)

    expect(response.body).to.have.property('error')
    expect(response.body.error.message).to.be.equal('Internal JSON-RPC error.')
  })

  it('returns error on chain check failure', async () => {
    // Failing chain check
    relayResponses['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] = '{"id":1,"jsonrpc":"2.0","result":"0x00"}'

    pocketMock.relayResponse = relayResponses
    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post('/v1/sd9fj31d714kgos42e68f9gh')
      .send({ method: 'eth_chainId', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet')
      .expect(200)

    expect(response.body).to.have.property('error')
    expect(response.body.error.message).to.be.equal('Internal JSON-RPC error.')
  })

  it('succesfully relays a loadbalancer application', async () => {
    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post('/v1/lb/gt4a1s9rfrebaf8g31bsdc04')
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .expect(200)

    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
    expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
  })

  it('succesfully relays a loadbalancer application with log limits', async () => {
    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post('/v1/lb/gt4a1s9rfrebaf8g31bsdc05')
      .send({
        method: 'eth_getLogs',
        params: [
          {
            fromBlock: '0x9c5bb6',
            toBlock: '0x9c5bb6',
            address: '0xdef1c0ded9bec7f1a1670819833240f027b25eff',
          },
        ],
        id: 1,
        jsonrpc: '2.0',
      })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .expect(200)

    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
  })

  it('returns an error when load balancer relay body is not a JSON', async () => {
    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post('/v1/lb/gt4a1s9rfrebaf8g31bsdc05')
      .send('{"method":"eth_getLogs","params":[{"fromBlock":"0x9c5bb6"')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .expect(200)

    expect(response.body).to.have.property('error')
    expect(response.body.error.message).to.be.equal('The request body is not proper JSON')
  })

  it('returns an error when application relay body is not a JSON', async () => {
    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post('/v1/sd9fj31d714kgos42e68f9gh')
      .send('{"method":"eth_getLogs","params":[{"fromBlock":"0x9c5bb6"')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .expect(200)

    expect(response.body).to.have.property('error')
    expect(response.body.error.message).to.be.equal('The request body is not proper JSON')
  })

  it('returns error when no load balancer is found', async () => {
    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post('/v1/lb/invalid')
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet')
      .expect(200)

    expect(response.body).to.have.property('error')
    expect(response.body.error.message).to.be.equal('Load balancer not found')
  })

  it('returns error on load balancer relay failure', async () => {
    pocketMock.fail = true
    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post('/v1/lb/gt4a1s9rfrebaf8g31bsdc04')
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-string') // blockchain without altruist
      .expect(200)

    expect(response.body).to.have.property('error')
    expect(response.body.error.message).to.be.equal('Internal JSON-RPC error.')
  })

  it('returns error when altruist returns non-json string as response', async () => {
    pocketMock.fail = true
    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    axiosMock
      .onPost(BLOCKCHAINS['0041']?.altruist, { method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .reply(200, '<html>503 Service Unavailable</html>')

    const response = await client
      .post('/v1/lb/gt4a1s9rfrebaf8g31bsdc04')
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .expect(200)

    expect(response.body).to.have.property('error')
    expect(response.body.error.message).to.be.equal('Internal JSON-RPC error.')
  })

  it('redirects empty path with specific load balancer', async () => {
    const gatewayHost = 'custom-host'
    const gatewayHostKey = 'gatewayHost'
    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket, {
      GATEWAY_HOST: gatewayHost,
    }))

    const response = await client
      .post('/')
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .expect(200)

    expect(app.find(gatewayHostKey)[0].getValue(app.getOwnerContext(gatewayHostKey))).equal(gatewayHost)
    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
    expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
  })

  it('fails on invalid redirect load balancer', async () => {
    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post('/')
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'invalid host')
      .expect(200)

    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.have.property('error')
    expect(response.body.error.message).to.be.equal('Invalid domain')
  })

  it('Perfoms sticky requests on LBs that support it using rpcID', async () => {
    const logSpy = sinon.spy(logger, 'log')

    const relayRequest = (id) => `{"method":"eth_chainId","id":${id},"jsonrpc":"2.0"}`
    const relayResponseData = (id) => `{"id":${id},"jsonrpc":"2.0","result":"0x64"}`
    const mockPocket = new PocketMock()

    // Reset default values
    mockPocket.relayResponse = {}

    // Sync/Chain check
    mockPocket.relayResponse['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] =
      '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
    mockPocket.relayResponse['{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}'] =
      '{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}'

    // Add some default relay requests
    for (let i = 0; i < 10; i++) {
      mockPocket.relayResponse[relayRequest(i)] = relayResponseData(i)
    }

    const pocketClass = mockPocket.object()

    ;({ app, client } = await setupApplication(pocketClass))

    for (let i = 1; i <= 5; i++) {
      const response = await client
        .post('/v1/lb/gt4a1s9rfrebaf8g31bsdc05')
        .send({ method: 'eth_chainId', id: i, jsonrpc: '2.0' })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet-x')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
    }

    // Counts the number of times the sticky relay succeeded
    let successStickyResponses = 0

    logSpy.getCalls().forEach(
      (call) =>
        (successStickyResponses = call.calledWith(
          'info',
          sinon.match.any,
          sinon.match((log: object) => {
            return log['sticky'] === 'SUCCESS'
          })
        )
          ? ++successStickyResponses
          : successStickyResponses)
    )

    // First request does  not count as sticky
    expect(successStickyResponses).to.be.equal(4)
  })

  it('Perfoms sticky requests on LBs that support it using prefix', async () => {
    const logSpy = sinon.spy(logger, 'log')

    const relayRequest = '{"method":"eth_chainId","id":0,"jsonrpc":"2.0"}'
    const mockPocket = new PocketMock()

    // Reset default values
    mockPocket.relayResponse = {}

    // Sync/Chain check
    mockPocket.relayResponse['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] =
      '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
    mockPocket.relayResponse['{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}'] =
      '{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}'

    mockPocket.relayResponse[relayRequest] = '{"id":0,"jsonrpc":"2.0","result":"0x64"}'

    const pocketClass = mockPocket.object()

    ;({ app, client } = await setupApplication(pocketClass))

    for (let i = 1; i <= 5; i++) {
      const response = await client
        .post('/v1/lb/df9gjsjg43db9fsajfjg93fk')
        .send({ method: 'eth_chainId', id: 1, jsonrpc: '2.0' })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet-x')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
    }

    // Counts the number of times the sticky relay succeeded
    let successStickyResponses = 0

    logSpy.getCalls().forEach(
      (call) =>
        (successStickyResponses = call.calledWith(
          'info',
          sinon.match.any,
          sinon.match((log: object) => {
            return log['sticky'] === 'SUCCESS'
          })
        )
          ? ++successStickyResponses
          : successStickyResponses)
    )

    // First request does  not count as sticky
    expect(successStickyResponses).to.be.equal(4)
  })

  it('Fails sticky requests due to not being on whitelist', async () => {
    const logSpy = sinon.spy(logger, 'log')

    const relayRequest = '{"method":"eth_chainId","id":0,"jsonrpc":"2.0"}'
    const mockPocket = new PocketMock()

    // Reset default values
    mockPocket.relayResponse = {}

    // Sync/Chain check
    mockPocket.relayResponse['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] =
      '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
    mockPocket.relayResponse['{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}'] =
      '{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}'

    mockPocket.relayResponse[relayRequest] = '{"id":0,"jsonrpc":"2.0","result":"0x64"}'

    const pocketClass = mockPocket.object()

    ;({ app, client } = await setupApplication(pocketClass))

    for (let i = 1; i <= 5; i++) {
      const response = await client
        .post('/v1/lb/d8ejd7834ht9d9sj345gfsoa')
        .send({ method: 'eth_chainId', id: 1, jsonrpc: '2.0' })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet-x')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
    }

    // Counts the number of times the sticky relay succeeded
    let successStickyResponses = 0

    logSpy.getCalls().forEach(
      (call) =>
        (successStickyResponses = call.calledWith(
          'info',
          sinon.match.any,
          sinon.match((log: object) => {
            return log['sticky'] === 'SUCCESS'
          })
        )
          ? ++successStickyResponses
          : successStickyResponses)
    )

    expect(successStickyResponses).to.be.equal(0)
  })

  it('Pass sticky requests due to being on whitelist', async () => {
    const logSpy = sinon.spy(logger, 'log')

    const relayRequest = '{"method":"eth_chainId","id":0,"jsonrpc":"2.0"}'
    const mockPocket = new PocketMock()

    // Reset default values
    mockPocket.relayResponse = {}

    // Sync/Chain check
    mockPocket.relayResponse['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] =
      '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
    mockPocket.relayResponse['{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}'] =
      '{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}'

    mockPocket.relayResponse[relayRequest] = '{"id":0,"jsonrpc":"2.0","result":"0x64"}'

    const pocketClass = mockPocket.object()

    ;({ app, client } = await setupApplication(pocketClass))

    for (let i = 1; i <= 5; i++) {
      const response = await client
        .post('/v1/lb/d8ejd7834ht9d9sj345gfsoa')
        .send({ method: 'eth_chainId', id: 1, jsonrpc: '2.0' })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet-x')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
    }

    // Counts the number of times the sticky relay succeeded
    let successStickyResponses = 0

    logSpy.getCalls().forEach(
      (call) =>
        (successStickyResponses = call.calledWith(
          'info',
          sinon.match.any,
          sinon.match((log: object) => log['sticky'] === 'SUCCESS')
        )
          ? ++successStickyResponses
          : successStickyResponses)
    )

    expect(successStickyResponses).to.be.equal(4)
  })

  it('Returns error on get request to app/lb', async () => {
    ;({ app, client } = await setupApplication())

    const appResponse = await client.get('/v1/abc1234').expect(200)
    const lbResponse = await client.get('/v1/abc1234').expect(200)

    const message = 'GET requests are not supported. Use POST instead'

    expect(appResponse.body).to.have.properties('error', 'id', 'jsonrpc')
    expect(appResponse.body.error.message).to.be.equal(message)

    expect(lbResponse.body).to.have.properties('error', 'id', 'jsonrpc')
    expect(lbResponse.body.error.message).to.be.equal(message)
  })

  it('relays a gigastaked lb', async () => {
    const logSpy = sinon.spy(logger, 'log')

    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post(`/v1/lb/${GIGASTAKE_FOLLOWER_IDS.lb}`)
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .expect(200)

    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
    expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)

    const originalAppLog = logSpy.calledWith(
      'info',
      sinon.match((arg: string) => arg.startsWith('SUCCESS RELAYING')),
      sinon.match((log: object) => log['typeID'] === GIGASTAKE_FOLLOWER_IDS.app)
    )

    expect(originalAppLog).to.be.true()

    const gigastakeAppID = logSpy.calledWith(
      'info',
      sinon.match((arg: string) => arg.startsWith('SUCCESS RELAYING')),
      sinon.match((log: object) => log['gigastakeAppID'] === GIGASTAKE_LEADER_IDS.app)
    )

    expect(gigastakeAppID).to.be.true()
  })

  describe('Rate-limiting applications and loadbalancers', () => {
    it('logs an error on request with rate-limited app & relay throws error', async () => {
      const pocket = pocketMock.object()
      const logSpy = sinon.spy(logger, 'log')

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${RATE_LIMITED_APPLICATION.id}`)
        .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet-x')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.property('error')
      expect(response.body.error.message).to.startWith('Rate limit exceeded. Please upgrade your plan.')

      const rateLimitWarningLogged = logSpy.calledWith(
        'error',
        sinon.match((arg: string) => arg.startsWith('application relay count has exceeded the rate limit'))
      )
      expect(rateLimitWarningLogged).to.be.true()
    })

    it('logs an error on lb relay request with rate-limited app & relay throws error', async () => {
      const pocket = pocketMock.object()
      const logSpy = sinon.spy(logger, 'log')

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/lb/${RATE_LIMITED_LB_ID.lb}`)
        .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet-x')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.property('error')
      expect(response.body.error.message).to.startWith('Rate limit exceeded. Please upgrade your plan.')

      const rateLimitWarningLogged = logSpy.calledWith(
        'warn',
        sinon.match((arg: string) =>
          arg.startsWith('relay count on application associated with the endpoint has exceeded the rate limit')
        )
      )
      expect(rateLimitWarningLogged).to.be.true()
    })

    it('logs warning on empty rate-limiter app list & relay suceeds', async () => {
      // Mocking empty rate-limited apps list
      axiosMock.onGet('https://rate.limiter').reply(200, {
        applicationIDs: [],
      })

      const pocket = pocketMock.object()
      const logSpy = sinon.spy(logger, 'log')

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/lb/${RATE_LIMITED_LB_ID.lb}`)
        .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet-x')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)

      const rateLimitWarningLogged = logSpy.calledWith(
        'warn',
        sinon.match((arg: string) => arg.startsWith('Rate-limited applications list is empty; rate-limiting disabled'))
      )
      expect(rateLimitWarningLogged).to.be.true()
    })

    it('logs an error on rate-limiter call failure & relay succeeds', async () => {
      // Mocking failure to fetch rate-limiter
      axiosMock.onGet('https://rate.limiter').reply(500)

      const pocket = pocketMock.object()
      const logSpy = sinon.spy(logger, 'log')

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/lb/${RATE_LIMITED_LB_ID.lb}`)
        .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet-x')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)

      const rateLimitWarningLogged = logSpy.calledWith(
        'error',
        sinon.match((arg: string) =>
          arg.startsWith(
            'Error fetching rate-limited applications list; setting cache to skip rate limited applications lookup for 300 seconds'
          )
        )
      )
      expect(rateLimitWarningLogged).to.be.true()
    })
  })

  describe('Contract/method whitelisting', () => {
    it('fails on request with restricted contract whitelist (eth_call)', async () => {
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [{ blockchainID: '0021', contracts: ['0x75f89ffbe5c25161cbc7e97c988c9f391eaefaf9'] }],
        whitelistMethods: [],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({
          method: 'eth_call',
          params: [{ to: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', data: '0x0902f1ac' }, 'latest'],
          id: 42,
          jsonrpc: '2.0',
        })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      console.log('ERROR HERE', response.body.error.message)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.property('error')
      expect(response.body.error.message).to.startWith('Restricted endpoint: contract address not allowed')
    })

    it('success on request with restricted contract whitelist (eth_call)', async () => {
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [{ blockchainID: '0021', contracts: ['0x75f89ffbe5c25161cbc7e97c988c9f391eaefaf9'] }],
        whitelistMethods: [],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      relayResponses['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
      relayResponses[
        '{"method":"eth_call","params":[{"to":"0x75f89ffbe5c25161cbc7e97c988c9f391eaefaf9","data":"0x0902f1ac"},"latest"],"id":42,"jsonrpc":"2.0"}'
      ] = '{"id":1,"jsonrpc":"2.0","result":"0x00"}'

      pocketMock.relayResponse = relayResponses

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({
          method: 'eth_call',
          params: [{ to: '0x75f89ffbe5c25161cbc7e97c988c9f391eaefaf9', data: '0x0902f1ac' }, 'latest'],
          id: 42,
          jsonrpc: '2.0',
        })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
    })

    it('fails on request with restricted contract whitelist (eth_sendRawTransaction)', async () => {
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [{ blockchainID: '0021', contracts: ['0x75f89ffbe5c25161cbc7e97c988c9f391eaefaf9'] }],
        whitelistMethods: [],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({
          id: 6695493563292,
          jsonrpc: '2.0',
          method: 'eth_sendRawTransaction',
          params: [
            '0xf901718219528506fc23ac0083025b939424ad62502d1c652cc7684081169d04896ac20f3080b9010438ed173900000000000000000000000000000000000000000000000027b41fcc7f854c0800000000000000000000000000000000000000000000000000000000012b6e3900000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000eadce7a42f0a03a12ab599e4abe199abbe4f75eb00000000000000000000000000000000000000000000000000000000623d6853000000000000000000000000000000000000000000000000000000000000000200000000000000000000000072cb10c6bfa5624dd07ef608027e366bd690048f000000000000000000000000985458e523db3d53125813ed68c274899e9dfab484c6ac98a3a0d558b81a80a3473dffea9784b8591c0ad8da8269dac39d94d88a5b25f3a66893a06bf8a29de0bdacd899a200b0b6226f3e781ec9887514b69deeb5af06b28ffd29',
          ],
        })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.property('error')
      expect(response.body.error.message).to.startWith('Restricted endpoint: contract address not allowed')
    })

    it('success on request with restricted contract whitelist (unsupported method)', async () => {
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [{ blockchainID: '0021', contracts: ['0x24ad62502d1c652cc7684081169d04896ac20f30'] }],
        whitelistMethods: [],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      relayResponses['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
      relayResponses['{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}'] =
        '{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}'

      pocketMock.relayResponse = relayResponses

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
    })

    it('success on request with restricted contract whitelist (eth_sendRawTransaction)', async () => {
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [{ blockchainID: '0021', contracts: ['0x24ad62502d1c652cc7684081169d04896ac20f30'] }],
        whitelistMethods: [],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      relayResponses['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
      relayResponses[
        '{"id":6695493563292,"jsonrpc":"2.0","method":"eth_sendRawTransaction","params":["0xf901718219528506fc23ac0083025b939424ad62502d1c652cc7684081169d04896ac20f3080b9010438ed173900000000000000000000000000000000000000000000000027b41fcc7f854c0800000000000000000000000000000000000000000000000000000000012b6e3900000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000eadce7a42f0a03a12ab599e4abe199abbe4f75eb00000000000000000000000000000000000000000000000000000000623d6853000000000000000000000000000000000000000000000000000000000000000200000000000000000000000072cb10c6bfa5624dd07ef608027e366bd690048f000000000000000000000000985458e523db3d53125813ed68c274899e9dfab484c6ac98a3a0d558b81a80a3473dffea9784b8591c0ad8da8269dac39d94d88a5b25f3a66893a06bf8a29de0bdacd899a200b0b6226f3e781ec9887514b69deeb5af06b28ffd29"]}'
      ] = '{"id":1,"jsonrpc":"2.0","result":"0x00"}'

      pocketMock.relayResponse = relayResponses

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({
          id: 6695493563292,
          jsonrpc: '2.0',
          method: 'eth_sendRawTransaction',
          params: [
            '0xf901718219528506fc23ac0083025b939424ad62502d1c652cc7684081169d04896ac20f3080b9010438ed173900000000000000000000000000000000000000000000000027b41fcc7f854c0800000000000000000000000000000000000000000000000000000000012b6e3900000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000eadce7a42f0a03a12ab599e4abe199abbe4f75eb00000000000000000000000000000000000000000000000000000000623d6853000000000000000000000000000000000000000000000000000000000000000200000000000000000000000072cb10c6bfa5624dd07ef608027e366bd690048f000000000000000000000000985458e523db3d53125813ed68c274899e9dfab484c6ac98a3a0d558b81a80a3473dffea9784b8591c0ad8da8269dac39d94d88a5b25f3a66893a06bf8a29de0bdacd899a200b0b6226f3e781ec9887514b69deeb5af06b28ffd29',
          ],
        })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
    })

    it('fails on request with restricted contract whitelist (eth_getLogs)', async () => {
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [{ blockchainID: '0021', contracts: ['0x75f89ffbe5c25161cbc7e97c988c9f391eaefaf9'] }],
        whitelistMethods: [],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({
          method: 'eth_getLogs',
          params: [
            { fromBlock: '0x9c5bb6', toBlock: '0x9c5bb6', address: '0xdef1c0ded9bec7f1a1670819833240f027b25eff' },
          ],
          id: 1,
          jsonrpc: '2.0',
        })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.property('error')
      expect(response.body.error.message).to.startWith('Restricted endpoint: contract address not allowed')
    })

    it('success on request with restricted contract whitelist (eth_getLogs)', async () => {
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [{ blockchainID: '0021', contracts: ['0xdef1c0ded9bec7f1a1670819833240f027b25eff'] }],
        whitelistMethods: [],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      relayResponses['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
      relayResponses[
        '{"method":"eth_getLogs","params":[{"fromBlock":"0x9c5bb6","toBlock":"0x9c5bb6","address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff"}],"id":1,"jsonrpc":"2.0"}'
      ] = '{"id":1,"jsonrpc":"2.0","result":"0x00"}'

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({
          method: 'eth_getLogs',
          params: [
            { fromBlock: '0x9c5bb6', toBlock: '0x9c5bb6', address: '0xdef1c0ded9bec7f1a1670819833240f027b25eff' },
          ],
          id: 1,
          jsonrpc: '2.0',
        })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
    })

    it('fails on request with restricted contract whitelist (eth_getCode, eth_getBalance, eth_getStorageAt, eth_getTransactionCount)', async () => {
      // Test includes the scope of the 4 methods, because all of them use the first param for contract address.
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [{ blockchainID: '0021', contracts: ['0x75f89ffbe5c25161cbc7e97c988c9f391eaefaf9'] }],
        whitelistMethods: [],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({
          jsonrpc: '2.0',
          method: 'eth_getStorageAt',
          params: ['0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9', '0x38', '0xdc8c48'],
          id: 165,
        })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.property('error')
      expect(response.body.error.message).to.startWith('Restricted endpoint: contract address not allowed')
    })

    it('success on request with restricted contract whitelist (eth_getCode, eth_getBalance, eth_getStorageAt, eth_getTransactionCount)', async () => {
      // Test includes the scope of the 4 methods, because all of them use the first param for contract address.
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [{ blockchainID: '0021', contracts: ['0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9'] }],
        whitelistMethods: [],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      relayResponses['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
      relayResponses[
        '{"jsonrpc":"2.0","method":"eth_getStorageAt","params":["0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9","0x38","0xdc8c48"],"id":165}'
      ] = '{"id":1,"jsonrpc":"2.0","result":"0x00"}'

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({
          jsonrpc: '2.0',
          method: 'eth_getStorageAt',
          params: ['0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9', '0x38', '0xdc8c48'],
          id: 165,
        })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
    })

    it('fails on request with restricted contract whitelist (bundled transactions)', async () => {
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [{ blockchainID: '0021', contracts: ['0x75f89ffbe5c25161cbc7e97c988c9f391eaefaf9'] }],
        whitelistMethods: [],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send([
          {
            jsonrpc: '2.0',
            method: 'eth_getStorageAt',
            params: ['0x5100bd31b822371108a0f63dcfb6594b9919eaf4', '0x38', '0xdc8c48'],
            id: 165,
          },
          {
            id: 678372812632,
            jsonrpc: '2.0',
            method: 'eth_sendRawTransaction',
            params: [
              '0xf88d4d8506fc23ac00831f1e6b945100bd31b822371108a0f63dcfb6594b9919eaf480a4528be0a9000000000000000000000000000000000000000000000000000000000001753c84c6ac98a4a0166f7f13fd495588c6fad5c6433e85e9ddb49970654b167ddbd45e3db86f4224a05f500ac871223166107943579a25e36b96f6283a9422ac06536f8191af9ea753',
            ],
          },
        ])
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.property('error')
      expect(response.body.error.message).to.startWith('Restricted endpoint: contract address not allowed')
    })

    it('success on request with restricted contract whitelist (bundled transactions)', async () => {
      // Test includes the scope of the 4 methods, because all of them use the first param for contract address.
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [{ blockchainID: '0021', contracts: ['0x5100bd31b822371108a0f63dcfb6594b9919eaf4'] }],
        whitelistMethods: [],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      relayResponses['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
      relayResponses[
        '[{"jsonrpc":"2.0","method":"eth_getStorageAt","params":["0x5100bd31b822371108a0f63dcfb6594b9919eaf4","0x38","0xdc8c48"],"id":165},{"id":678372812632,"jsonrpc":"2.0","method":"eth_sendRawTransaction","params":["0xf88d4d8506fc23ac00831f1e6b945100bd31b822371108a0f63dcfb6594b9919eaf480a4528be0a9000000000000000000000000000000000000000000000000000000000001753c84c6ac98a4a0166f7f13fd495588c6fad5c6433e85e9ddb49970654b167ddbd45e3db86f4224a05f500ac871223166107943579a25e36b96f6283a9422ac06536f8191af9ea753"]}]'
      ] = '{"id":1,"jsonrpc":"2.0","result":"0x00"}'

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send([
          {
            jsonrpc: '2.0',
            method: 'eth_getStorageAt',
            params: ['0x5100bd31b822371108a0f63dcfb6594b9919eaf4', '0x38', '0xdc8c48'],
            id: 165,
          },
          {
            id: 678372812632,
            jsonrpc: '2.0',
            method: 'eth_sendRawTransaction',
            params: [
              '0xf88d4d8506fc23ac00831f1e6b945100bd31b822371108a0f63dcfb6594b9919eaf480a4528be0a9000000000000000000000000000000000000000000000000000000000001753c84c6ac98a4a0166f7f13fd495588c6fad5c6433e85e9ddb49970654b167ddbd45e3db86f4224a05f500ac871223166107943579a25e36b96f6283a9422ac06536f8191af9ea753',
            ],
          },
        ])
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
    })

    it('fails on request with restricted method whitelist', async () => {
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [],
        whitelistMethods: [{ blockchainID: '0021', methods: ['eth_getLogs'] }],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({
          method: 'eth_call',
          params: [{ to: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', data: '0x0902f1ac' }, 'latest'],
          id: 42,
          jsonrpc: '2.0',
        })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.property('error')
      expect(response.body.error.message).to.startWith('Restricted endpoint: method not allowed')
    })

    it('success on request with restricted method whitelist', async () => {
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [],
        whitelistMethods: [{ blockchainID: '0021', methods: ['eth_getLogs'] }],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      relayResponses['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
      relayResponses[
        '{"method":"eth_getLogs","params":[{"fromBlock":"0x9c5bb6","toBlock":"0x9c5bb6","address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff"}],"id":1,"jsonrpc":"2.0"}'
      ] = '{"id":1,"jsonrpc":"2.0","result":"0x00"}'

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({
          method: 'eth_getLogs',
          params: [
            { fromBlock: '0x9c5bb6', toBlock: '0x9c5bb6', address: '0xdef1c0ded9bec7f1a1670819833240f027b25eff' },
          ],
          id: 1,
          jsonrpc: '2.0',
        })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
    })

    it('success on request without restricted method whitelist', async () => {
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [],
        whitelistMethods: [{ blockchainID: '0021', methods: ['eth_getLogs'] }],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      relayResponses['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
      relayResponses[
        '{"method":"eth_getLogs","params":[{"fromBlock":"0x9c5bb6","toBlock":"0x9c5bb6","address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff"}],"id":1,"jsonrpc":"2.0"}'
      ] = '{"id":1,"jsonrpc":"2.0","result":"0x00"}'

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({
          method: 'eth_getLogs',
          params: [
            { fromBlock: '0x9c5bb6', toBlock: '0x9c5bb6', address: '0xdef1c0ded9bec7f1a1670819833240f027b25eff' },
          ],
          id: 1,
          jsonrpc: '2.0',
        })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet-x')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
    })

    it('success on request without restricted contracts whitelist', async () => {
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [{ blockchainID: '0021', contracts: ['0x24ad62502d1c652cc7684081169d04896ac20f30'] }],
        whitelistMethods: [],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      relayResponses['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
      relayResponses[
        '{"method":"eth_getLogs","params":[{"fromBlock":"0x9c5bb6","toBlock":"0x9c5bb6","address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff"}],"id":1,"jsonrpc":"2.0"}'
      ] = '{"id":1,"jsonrpc":"2.0","result":"0x00"}'

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({
          method: 'eth_getLogs',
          params: [
            { fromBlock: '0x9c5bb6', toBlock: '0x9c5bb6', address: '0xdef1c0ded9bec7f1a1670819833240f027b25eff' },
          ],
          id: 1,
          jsonrpc: '2.0',
        })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet-x')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
    })

    it('fails on request with restricted blockchain whitelist', async () => {
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: ['0040'],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [],
        whitelistMethods: [],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({
          method: 'eth_call',
          params: [{ to: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', data: '0x0902f1ac' }, 'latest'],
          id: 42,
          jsonrpc: '2.0',
        })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.property('error')
      expect(response.body.error.message).to.startWith('Restricted endpoint: blockchain not allowed')
    })

    it('success on request with restricted blockchain whitelist', async () => {
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: ['0021'],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [],
        whitelistMethods: [],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      relayResponses['{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'] = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
      relayResponses[
        '{"method":"eth_getLogs","params":[{"fromBlock":"0x9c5bb6","toBlock":"0x9c5bb6","address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff"}],"id":1,"jsonrpc":"2.0"}'
      ] = '{"id":1,"jsonrpc":"2.0","result":"0x00"}'

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({
          method: 'eth_getLogs',
          params: [
            { fromBlock: '0x9c5bb6', toBlock: '0x9c5bb6', address: '0xdef1c0ded9bec7f1a1670819833240f027b25eff' },
          ],
          id: 1,
          jsonrpc: '2.0',
        })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
    })

    it('fails on request with blocked contract address', async () => {
      const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

      appWithSecurity.gatewaySettings = {
        secretKey: '',
        secretKeyRequired: false,
        whitelistBlockchains: [],
        whitelistOrigins: [],
        whitelistUserAgents: [],
        whitelistContracts: [],
        whitelistMethods: [],
      }

      const dbApp = await applicationsRepository.create(appWithSecurity)

      const pocket = pocketMock.object()

      ;({ app, client } = await setupApplication(pocket))

      const response = await client
        .post(`/v1/${dbApp.id}`)
        .send({
          method: 'eth_call',
          params: [{ to: '0x5d13399e7a59941734900157381e2d0b9d29c971', data: '0x0902f1ac' }, 'latest'],
          id: 42,
          jsonrpc: '2.0',
        })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet')
        .set('origin', 'localhost')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.property('error')
      expect(response.body.error.message).to.startWith('Restricted endpoint: contract address not allowed')
    })

    it('invokes POST /v1/{appId} and successfully relays a request only through the altruist', async () => {
      const pocket = pocketMock.object()
      const logSpy = sinon.spy(logger, 'log')

      ;({ app, client } = await setupApplication(pocket, { ALTRUIST_ONLY_CHAINS: '0041' }))

      const response = await client
        .post('/v1/sd9fj31d714kgos42e68f9gh')
        .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
        .set('Accept', 'application/json')
        .set('host', 'eth-mainnet-x')
        .expect(200)

      expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
      expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
      expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)

      const expectedAltruistLog = logSpy.calledWith(
        'info',
        sinon.match((arg: string) => arg.startsWith('SUCCESS FALLBACK RELAYING 0041')),
        sinon.match((log: object) => log['forcedFallback'] === true)
      )

      expect(expectedAltruistLog).to.be.true()

      // No session is being dispatched, hence is only being called through the altruist
      const notExpectedLog = logSpy.calledWith(
        'info',
        sinon.match((arg: string) => arg.startsWith('success dispatcher call to obtain session'))
      )

      expect(notExpectedLog).to.be.false()
    })
  })
})
