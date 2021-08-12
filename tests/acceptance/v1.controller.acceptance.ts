import { Client, sinon, expect } from '@loopback/testlab'
import { PocketGatewayApplication } from '../..'
import { setupApplication } from './test-helper'
import { BlockchainsRepository } from '../../src/repositories/blockchains.repository'
import { gatewayTestDB } from '../fixtures/test.datasource'
import { PocketMock } from '../mocks/pocketjs'
import { Configuration, Pocket } from '@pokt-network/pocket-js'
import { DEFAULT_POCKET_CONFIG } from '../../src/config/pocket-config'
import { ApplicationsRepository } from '../../src/repositories/applications.repository'

const BLOCKCHAINS = [
  {
    hash: '0001',
    ticker: 'POKT',
    networkID: 'mainnet',
    network: 'POKT-mainnet',
    description: 'Pocket Network Mainnet',
    index: 1,
    blockchain: 'mainnet',
    active: true,
    enforceResult: 'JSON',
    nodeCount: 1,
  },
  {
    hash: '0021',
    ticker: 'ETH',
    networkID: '1',
    network: 'ETH-1',
    description: 'Ethereum Mainnet',
    index: 2,
    blockchain: 'eth-mainnet',
    active: true,
    enforceResult: 'JSON',
    nodeCount: 1,
    chainIDCheck: '{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}',
    syncCheck: '{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}',
    // Does not actually exist on this chain, only for testing purposes
    syncCheckPath: '/v1/query/height',
    syncAllowance: 2,
  },
  {
    hash: '0040',
    ticker: 'ETHS',
    networkID: '1',
    network: 'ETH-1S',
    description: 'Ethereum Mainnet String',
    index: 3,
    blockchain: 'eth-mainnet-string',
    active: true,
    nodeCount: 1,
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

describe('V1 controller (acceptance)', () => {
  let app: PocketGatewayApplication
  let client: Client
  let blockchainsRepository: BlockchainsRepository
  let applicationsRepository: ApplicationsRepository
  let pocketMock: PocketMock
  let pocketConfiguration: Configuration
  let pocketClass: typeof Pocket

  before('setupApplication', async () => {
    pocketConfiguration = new Configuration(
      DEFAULT_POCKET_CONFIG.MAX_DISPATCHERS,
      DEFAULT_POCKET_CONFIG.MAX_SESSIONS,
      DEFAULT_POCKET_CONFIG.CONSENSUS_NODE_COUNT,
      DEFAULT_POCKET_CONFIG.REQUEST_TIMEOUT,
      DEFAULT_POCKET_CONFIG.ACCEPT_DISPUTED_RESPONSES,
      4,
      10200,
      DEFAULT_POCKET_CONFIG.VALIDATE_RELAY_RESPONSES,
      DEFAULT_POCKET_CONFIG.REJECT_SELF_SIGNED_CERTIFICATES,
      DEFAULT_POCKET_CONFIG.USE_LEGACY_TX_CODEC
    )

    blockchainsRepository = new BlockchainsRepository(gatewayTestDB)
    applicationsRepository = new ApplicationsRepository(gatewayTestDB)

    pocketMock = new PocketMock(undefined, undefined, pocketConfiguration)
    pocketMock.relayResponse['{"method":"eth_blockNumber","params":[],"id":1,"jsonrpc":"2.0"}'] =
      '{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}'

    pocketClass = pocketMock.class()
  })

  after(async () => {
    await app.stop()
  })

  beforeEach(async () => {
    await blockchainsRepository.createAll(BLOCKCHAINS)
    await applicationsRepository.create(APPLICATION)
  })

  afterEach(async () => {
    sinon.restore()
    await blockchainsRepository.deleteAll()
    await applicationsRepository.deleteAll()
  })

  it('invokes GET /v1/{appId} and successfully relays a request', async () => {
    ;({ app, client } = await setupApplication(pocketClass))

    const response = await client
      .post('/v1/sd9fj31d714kgos42e68f9gh')
      .send({ method: 'eth_blockNumber', params: [], id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'mainnet')
      .expect(200)

    const expected = { id: 1, jsonrpc: '2.0', result: '0x1083d57' }

    expect(response.headers).to.containDeep({ 'content-type': 'application/json' })
    expect(response.body).to.be.deepEqual(expected)
  })

  it('returns 404 when no app is found', async () => {
    ;({ app, client } = await setupApplication(pocketClass))

    await applicationsRepository.deleteAll()

    const res = await client
      .post('/v1/sd9fj31d714kgos42e68f9gh')
      .send({ method: 'eth_blockNumber', params: [], id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'mainnet')
      .expect(200)

    expect(res.body).to.have.property('message')
    expect(res.body.message).to.startWith('Entity not found')
  })

  it('returns 404 when the specified blockchain is not found', async () => {
    ;({ app, client } = await setupApplication(pocketClass))

    await blockchainsRepository.deleteAll()

    const res = await client
      .post('/v1/sd9fj31d714kgos42e68f9gh')
      .send({ method: 'eth_blockNumber', params: [], id: 1, jsonrpc: '2.0' })
      .set('Accept', 'application/json')
      .set('host', 'mainnet')
      .expect(200)

    expect(res.body).to.have.property('message')
    expect(res.body.message).to.startWith('Incorrect blockchain')
  })
})
