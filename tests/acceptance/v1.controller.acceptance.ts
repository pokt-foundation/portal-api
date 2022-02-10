import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { Encryptor } from 'strong-cryptor'
import { Client, sinon, expect } from '@loopback/testlab'
import { RpcError } from '@pokt-network/pocket-js'
import { PocketGatewayApplication } from '../..'
import { ApplicationsRepository } from '../../src/repositories/applications.repository'
import { BlockchainsRepository } from '../../src/repositories/blockchains.repository'
import { LoadBalancersRepository } from '../../src/repositories/load-balancers.repository'
import { MAX_RELAYS_ERROR } from '../../src/utils/constants'
import { gatewayTestDB } from '../fixtures/test.datasource'
import { DEFAULT_NODES, MockRelayResponse, PocketMock } from '../mocks/pocketjs'
import { setupApplication, DUMMY_ENV } from './test-helper'
const seedrandom = require('seedrandom')

const logger = require('../../src/services/logger')

// Must be the same one from the test environment on ./test-helper.ts
const DB_ENCRYPTION_KEY = '00000000000000000000000000000000'

const BLOCKCHAIN_CHECKS = {
  '100': {
    syncCheck: '{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}',
    chainCheck: '{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}',
  },
}

// Might not actually reflect real-world values
const BLOCKCHAINS = [
  {
    hash: '0001',
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
  },
  {
    hash: '0021',
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
    chainIDCheck: BLOCKCHAIN_CHECKS[100].chainCheck,
    syncCheckOptions: {
      body: BLOCKCHAIN_CHECKS[100].syncCheck,
      resultKey: 'result',
      allowance: 5,
      path: '',
    },
  },
  {
    hash: '0040',
    ticker: 'ETHS',
    networkID: '1',
    network: 'ETH-1S',
    description: 'Ethereum Mainnet String',
    index: 3,
    blockchain: 'eth-mainnet-string',
    blockchainAliases: ['eth-mainnet-string'],
    active: true,
    nodeCount: 1,
    chainID: '64',
  },
  {
    hash: '0041',
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
    syncCheckOptions: {
      body: BLOCKCHAIN_CHECKS[100].syncCheck,
      resultKey: 'result',
      allowance: 5,
    },
  },
]

const APPLICATION = {
  id: 'sd9fj31d714kgos42e68f9gh',
  name: 'Test',
  owner: 'test',
  icon: '',
  publicPocketAccount: {
    address: 'zbsh21mrn411umuyv2xh7e85cme3tf7er1assuop',
    publicKey: '9c1osndf3hj5wvkgi5ounpqwdhzcyzfy0qrk6z7o',
  },
  freeTier: true,
  freeTierApplicationAccount: {
    address: 'qglysyptu3ga0tq8qfi4pxvdxo1cg629oh6s8uom',
    publicKey: '74xyfz6bey09pmtayj0ma7vvqq15cb8y7w7vv4jfrf1tjsh7o6fppk0xbw4zlcbr',
    privateKey: '',
  },
  gatewaySettings: {
    secretKey: 'y1lhuxbpo7u3hvxzqvesbx7jcjdczw3j',
    secretKeyRequired: false,
    whitelistOrigins: [],
    whitelistUserAgents: [],
  },
  freeTierAAT: {
    version: '0.0.1',
    clientPublicKey: 'zxllicp807cz107r9b4vpeenepmr4quhz8dlek85f2faj1nwaey7oo7emamdf6nq',
    applicationPublicKey: '4jsdmxn9zbej57dejhnjcp355ezq20locf6wypr6lndwzmpt4akiiofxdqn8naqe',
  },
  updatingStatus: false,
  gatewayAAT: {
    version: '0.0.1',
    clientPublicKey: 'f8sqxrxhzjt59mk1vmm4v3r1l62rf1xwt5e6yrc3vaktnfvmf0x9ggs8jkjxlp4c',
    applicationPublicKey: '0m8nn4vfh6n3kk8mynbfphm7j4np8kgi14ul0tcy4chdx4i7v6uhjetb1q8eo5fo',
    applicationSignature:
      '87ux2poyr319tp9un97nflybr3l66umrjf4p5ifmwb6aq3frpgl9mqolikt1xcpu4d1o321pbm0edizck8tsnr8e8fdmazxskr9c5zx0ab9z1so2g8x29xazaffse8c0',
  },
}

const LB_IDS_NAMES = {
  GIGASTAKE_LEADER: 'hovj6nfix1nr0dknadwawawaqo',
  GIGASTAKE_FOLLOWER: 'df9f9f9gdklkwotn5o3ixuso3od',
  LB_WITH_TWO_APPS: 'dsdhc7w56hfysow83rhfgsadh',
}

const GIGASTAKE_LEADER_IDS = {
  app: 'dofwms0cosmasiqqoadldfisdsf',
  lb: LB_IDS_NAMES.GIGASTAKE_LEADER,
}
const GIGASTAKE_FOLLOWER_IDS = {
  app: 'asassd9sd0ffjdcusue2fidisss',
  lb: LB_IDS_NAMES.GIGASTAKE_FOLLOWER,
}

const APPLICATIONS = [
  APPLICATION,
  { ...APPLICATION, id: 'fg5fdj31d714kdif9g9fe68foth' },
  { ...APPLICATION, id: 'cienuohoddigue4w232s9rjafgx' },
  { ...APPLICATION, id: GIGASTAKE_LEADER_IDS.app },
  { ...APPLICATION, id: GIGASTAKE_FOLLOWER_IDS.app },
]

const LOAD_BALANCERS = [
  {
    id: 'gt4a1s9rfrebaf8g31bsdc04',
    user: 'test@test.com',
    name: 'test load balancer',
    requestTimeout: 5000,
    applicationIDs: APPLICATIONS.map((app) => app.id),
  },
  {
    id: 'gt4a1s9rfrebaf8g31bsdc05',
    user: 'test@test.com',
    name: 'test load balancer sticky rpc',
    requestTimeout: 5000,
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
    requestTimeout: 5000,
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
    id: 'd8ejd7834ht9d9sj345gfsoaao',
    user: 'test@test.com',
    name: 'test load balancer sticky prefix with whitelist',
    requestTimeout: 5000,
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
    requestTimeout: 5000,
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
    requestTimeout: 5000,
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
    id: LB_IDS_NAMES.LB_WITH_TWO_APPS,
    user: 'test@test.com',
    name: 'lb with two apps',
    requestTimeout: 5000,
    applicationIDs: [GIGASTAKE_FOLLOWER_IDS.app, GIGASTAKE_LEADER_IDS.app],
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
]

const ALTRUISTS = JSON.parse(DUMMY_ENV.ALTRUISTS)

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
  })

  after(async () => {
    await app.stop()
  })

  beforeEach(async () => {
    relayResponses = {
      '{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}': '{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}',
      '{"method":"eth_getLogs","params":[{"fromBlock":"0x9c5bb6","toBlock":"0x9c5bb6","address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff"}],"id":1,"jsonrpc":"2.0"}':
        '{"jsonrpc":"2.0","id":1,"result":[{"address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff","blockHash":"0x2ad90e24266edd835bb03071c0c0b58ee8356c2feb4576d15b3c2c2b2ef319c5","blockNumber":"0xc5bdc9","data":"0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000767fe9edc9e0df98e07454847909b5e959d7ca0e0000000000000000000000000000000000000000000000019274b259f653fc110000000000000000000000000000000000000000000000104bf2ffa4dcbf8de5","logIndex":"0x4c","removed":false,"topics":["0x0f6672f78a59ba8e5e5b5d38df3ebc67f3c792e2c9259b8d97d7f00dd78ba1b3","0x000000000000000000000000e5feeac09d36b18b3fa757e5cf3f8da6b8e27f4c"],"transactionHash":"0x14430f1e344b5f95ea68a5f4c0538fc732cc97efdc68f6ee0ba20e2c633542f6","transactionIndex":"0x1a"}]}',
    }

    axiosMock
      .onPost(ALTRUISTS['0041'], { method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .reply(200, relayResponses['{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}'])

    axiosMock
      .onPost(ALTRUISTS['0021'], { method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .reply(200, relayResponses['{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}'])

    pocketMock = new PocketMock(undefined, undefined, undefined)
    pocketMock.relayResponse = relayResponses

    await loadBalancersRepository.createAll(LOAD_BALANCERS)
    await blockchainsRepository.createAll(BLOCKCHAINS)
    await applicationsRepository.createAll(APPLICATIONS)
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

  it('invokes GET /v1/{appId} and successfully relays a request', async () => {
    const pocket = pocketMock.object()

    relayResponses['{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}'] =
      '{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}'
    //@ts-ignore
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
    await applicationsRepository.deleteAll()

    const encryptor = new Encryptor({ key: DB_ENCRYPTION_KEY })
    const key = 'encrypt123456789120encrypt123456789120'
    const encryptedKey = encryptor.encrypt(key)

    const appWithSecurity = { ...APPLICATION, id: 'secretAppID12345' }

    appWithSecurity.gatewaySettings = {
      secretKey: encryptedKey,
      secretKeyRequired: true,
      whitelistOrigins: [],
      whitelistUserAgents: [],
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
    await applicationsRepository.deleteAll()

    const appWithSecurity = { ...APPLICATION, id: 'recordApp123' }

    appWithSecurity.gatewaySettings = {
      secretKey: '',
      secretKeyRequired: false,
      whitelistOrigins: ['unlocalhost'],
      whitelistUserAgents: [],
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

  it('success relay with correct secret key, origin and userAgent security', async () => {
    await applicationsRepository.deleteAll()

    const encryptor = new Encryptor({ key: DB_ENCRYPTION_KEY })
    const key = 'encrypt123456789120encrypt123456789120'
    const encryptedKey = encryptor.encrypt(key)

    const appWithSecurity = { ...APPLICATION }

    appWithSecurity.gatewaySettings = {
      secretKey: encryptedKey,
      secretKeyRequired: true,
      whitelistOrigins: ['unlocalhost'],
      whitelistUserAgents: ['Mozilla/5.0'],
    }

    await applicationsRepository.create(appWithSecurity)

    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket))

    const response = await client
      .post('/v1/sd9fj31d714kgos42e68f9gh')
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
    expect(response.body.error.message).to.be.equal('Relay attempts exhausted')
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
    expect(response.body.error.message).to.be.equal('Relay attempts exhausted')
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
    expect(response.body.error.message).to.be.equal('Relay attempts exhausted')
  })

  it('redirects empty path with specific load balancer', async () => {
    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket, {
      REDIRECTS:
        '[{"domain": "eth-mainnet-x", "blockchain": "eth-mainnet-x", "loadBalancerID" : "gt4a1s9rfrebaf8g31bsdc04"}]',
    }))

    const response = await client
      .post('/')
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .expect(200)

    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.have.properties('id', 'jsonrpc', 'result')
    expect(parseInt(response.body.result, 16)).to.be.aboveOrEqual(0)
  })

  it("app doesn't initialize when no redirects are set", async () => {
    const pocket = pocketMock.object()

    await expect(
      setupApplication(pocket, {
        REDIRECTS: '',
      })
    ).to.rejectedWith(Error)
  })

  it('fails on invalid redirect load balancer', async () => {
    const pocket = pocketMock.object()

    ;({ app, client } = await setupApplication(pocket, {
      REDIRECTS:
        '[{"domain": "eth-mainnet", "blockchain": "eth-mainnet", "loadBalancerID" : "gt4a1s9rfrebaf8g31bsdc04"}]',
    }))

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

  it('Performs sticky requests on LBs that support it using rpcID', async () => {
    const logSpy = sinon.spy(logger, 'log')

    const relayRequest = (id) => `{"method":"eth_chainId","id":${id},"jsonrpc":"2.0"}`
    const relayResponseData = (id) => `{"id":${id},"jsonrpc":"2.0","result":"0x64"}`
    const mockPocket = new PocketMock()

    // Reset default values
    mockPocket.relayResponse = {}

    // Sync/Chain check
    mockPocket.relayResponse[BLOCKCHAIN_CHECKS[100].chainCheck] = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
    mockPocket.relayResponse[BLOCKCHAIN_CHECKS[100].syncCheck] = '{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}'

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
        .set('host', 'eth-mainnet')
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
        .post('/v1/lb/d8ejd7834ht9d9sj345gfsoaao')
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
        .post('/v1/lb/d8ejd7834ht9d9sj345gfsoaao')
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

    ;({ app, client } = await setupApplication(pocket, {
      REDIRECTS: JSON.stringify([
        {
          domain: 'mainnet.example.com',
          blockchain: 'mainnet',
          loadBalancerID: GIGASTAKE_LEADER_IDS.lb,
          blockchainAliases: ['mainnet'],
        },
      ]),
    }))

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

  it('fails first request due to session exhausted, following request goes to another non-exhausted app and succeeds', async () => {
    // Guaranteed to return >= 0.5 for at least the first 6 calls, therefore picking the second app of the lb
    seedrandom('43', { global: true })

    const logSpy = sinon.spy(logger, 'log')

    const mockPocket = new PocketMock()

    mockPocket.relayResponse[BLOCKCHAIN_CHECKS[100].syncCheck] = [
      // First relay sync check result
      ...Array(DEFAULT_NODES.length).fill(new RpcError('90', MAX_RELAYS_ERROR)),
      // Second relay sync check result, plus one for the actual relay request (which is the same method)
      ...Array(DEFAULT_NODES.length + 1).fill('{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}'),
    ]
    ;({ app, client } = await setupApplication(mockPocket.object()))

    const responseFallback = await client
      .post(`/v1/lb/${LB_IDS_NAMES.LB_WITH_TWO_APPS}`)
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .expect(200)

    expect(responseFallback.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(responseFallback.body).to.have.properties('id', 'jsonrpc', 'result')
    expect(parseInt(responseFallback.body.result, 16)).to.be.aboveOrEqual(0)

    const expectedFallbackLog = logSpy.calledWith(
      'info',
      sinon.match((arg: string) => {
        return arg.startsWith('SUCCESS FALLBACK RELAYING')
      })
    )

    expect(expectedFallbackLog).to.be.true()

    // The last log is the one with the fallback success information, that is assured in the assertion before
    // so from that same log properties we then obtain the typeID
    const failureID = logSpy.args[logSpy.args.length - 1][2]['typeID']

    // Relay that sets the app as exhausted
    const responseExhausted = await client
      .post(`/v1/lb/${LB_IDS_NAMES.LB_WITH_TWO_APPS}`)
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .expect(200)

    expect(responseExhausted.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(responseExhausted.body).to.have.properties('id', 'jsonrpc', 'result')
    expect(parseInt(responseExhausted.body.result, 16)).to.be.aboveOrEqual(0)

    const expectedExhuastedLog = logSpy.calledWith(
      'warn',
      sinon.match((arg: string) => {
        return arg.includes('has exhausted all node relays')
      })
    )

    expect(expectedExhuastedLog).to.be.true()

    // The session key is generated from the node's public keys and the mock uses the same nodes
    // for all calls therefore generating the same key, so is needed to generate nodes with other public keys
    // so they're not threated as the same and fail due to exhaustion again.
    mockPocket.nodes = Array(5)
      .fill(1)
      .map(() => PocketMock.getRandomNote())

    const { client: client2 } = await setupApplication(mockPocket.object())

    const responseRelay = await client2
      .post(`/v1/lb/${LB_IDS_NAMES.LB_WITH_TWO_APPS}`)
      .send({ method: 'eth_blockNumber', id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'eth-mainnet-x')
      .expect(200)

    expect(responseRelay.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(responseRelay.body).to.have.properties('id', 'jsonrpc', 'result')
    expect(parseInt(responseRelay.body.result, 16)).to.be.aboveOrEqual(0)

    const expectedSuccessLog = logSpy.calledWith(
      'info',
      sinon.match((arg: string) => {
        return arg.startsWith('SUCCESS RELAYING')
      })
    )

    expect(expectedSuccessLog).to.be.true()

    // Just like with the fallback, the last log corresponds to the success relay but using the service node now
    const successID = logSpy.args[logSpy.args.length - 1][2]['typeID']

    expect(successID).to.not.be.equal(failureID)
  })
})
