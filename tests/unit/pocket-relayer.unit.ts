import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import RedisMock from 'ioredis-mock'
import { Encryptor } from 'strong-cryptor'
import { HttpErrors } from '@loopback/rest'
import { expect, sinon } from '@loopback/testlab'
import { HTTPMethod, Configuration, Node } from '@pokt-network/pocket-js'

import AatPlans from '../../src/config/aat-plans.json'
import { getPocketConfigOrDefault } from '../../src/config/pocket-config'
import { ChainChecker, ChainIDFilterOptions } from '../../src/services/chain-checker'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { PocketRelayer } from '../../src/services/pocket-relayer'
import { ConsensusFilterOptions, SyncChecker } from '../../src/services/sync-checker'
import { Applications } from '../../src/models/applications.model'
import { metricsRecorderMock } from '../mocks/metricsRecorder'
import { DEFAULT_NODES, PocketMock } from '../mocks/pocketjs'
import { BlockchainsRepository } from '../../src/repositories/blockchains.repository'
import { gatewayTestDB } from '../fixtures/test.datasource'
import { LimitError } from '../../src/errors/types'

const DB_ENCRYPTION_KEY = '00000000000000000000000000000000'

const DEFAULT_LOG_LIMIT = 10000

const DEFAULT_HOST = 'eth-mainnet-x'

const BLOCKCHAINS = [
  {
    hash: '0041',
    ticker: 'ETHX',
    networkID: '1',
    network: 'ETH-2',
    description: 'Ethereum Mainnet X',
    index: 2,
    blockchain: 'eth-mainnet-x',
    active: true,
    enforceResult: 'JSON',
    nodeCount: 1,
    chainID: '137',
    syncAllowance: 5,
    logLimitBlocks: 10000,
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
    logLimitBlocks: 10000,
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
    logLimitBlocks: 10000,
    chainIDCheck: '{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}',
    syncCheck: '{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}',
  },
]

const ALTRUISTS = {
  '0021': 'https://user:pass@backups.example.org:18081',
  '0040': 'https://user:pass@backups.example.org:18081',
}

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

describe('Pocket relayer service (unit)', () => {
  let cherryPicker: CherryPicker
  let chainChecker: ChainChecker
  let syncChecker: SyncChecker
  let metricsRecorder: MetricsRecorder
  let blockchainRepository: BlockchainsRepository
  let redis: RedisMock
  let pocketConfiguration: Configuration
  let pocketMock: PocketMock
  let pocketRelayer: PocketRelayer

  const origin = 'unit-test'

  before('initialize variables', async () => {
    redis = new RedisMock(0, '')
    cherryPicker = new CherryPicker({ redis, checkDebug: false })
    metricsRecorder = metricsRecorderMock(redis, cherryPicker)
    chainChecker = new ChainChecker(redis, metricsRecorder, origin)
    syncChecker = new SyncChecker(redis, metricsRecorder, 5, origin)
    blockchainRepository = new BlockchainsRepository(gatewayTestDB)

    pocketConfiguration = getPocketConfigOrDefault()

    pocketMock = new PocketMock(undefined, undefined, pocketConfiguration)

    const pocket = pocketMock.object()

    pocketRelayer = new PocketRelayer({
      host: DEFAULT_HOST,
      origin: '',
      userAgent: '',
      pocket,
      pocketConfiguration,
      cherryPicker,
      metricsRecorder,
      syncChecker,
      chainChecker,
      redis,
      databaseEncryptionKey: DB_ENCRYPTION_KEY,
      secretKey: '',
      relayRetries: 0,
      blockchainsRepository: blockchainRepository,
      checkDebug: true,
      altruists: '{}',
      aatPlan: AatPlans.FREEMIUM,
      defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
    })
  })

  after(() => {
    sinon.restore()
  })

  const clean = async () => {
    await blockchainRepository.deleteAll()
    await redis.flushall()
    sinon.restore()
  }

  beforeEach(clean)

  it('should be defined', async () => {
    expect(pocketRelayer).to.be.ok()
  })

  it('parses the methods of multiple requests on a single call', () => {
    const multipleMethodsRequest = [
      { method: 'eth_blockNumber', params: [], id: 1, jsonrpc: '2.0' },
      { method: 'eth_getLogs', params: [], jsonrpc: '2.0' },
    ]

    const methods = pocketRelayer.parseMethod(multipleMethodsRequest)

    expect(methods).to.be.equal(`${multipleMethodsRequest[0].method},${multipleMethodsRequest[1].method}`)

    const singleMethodRequest = { method: 'eth_blockNumber', params: [], id: 1, jsonrpc: '2.0' }

    const method = pocketRelayer.parseMethod(singleMethodRequest)

    expect(method).to.be.equal(singleMethodRequest.method)
  })

  it('updates request timeout config of pocket sdk', () => {
    const timeout = 5
    const newConfig = pocketRelayer.updateConfiguration(timeout)

    expect(newConfig.requestTimeOut).to.be.equal(timeout)
  })

  it('loads all blockchains from db, caches them and returns config of requested blockchain', async () => {
    const dbBlockchains = await blockchainRepository.createAll(BLOCKCHAINS)

    expect(dbBlockchains).to.be.length(3)

    const repositorySpy = sinon.spy(blockchainRepository, 'find')
    const redisGetSpy = sinon.spy(redis, 'get')
    const redisSetSpy = sinon.spy(redis, 'set')

    let blockchainResult = await pocketRelayer.loadBlockchain()

    expect(blockchainResult).to.be.ok()
    expect(blockchainResult.blockchainID).to.be.equal(BLOCKCHAINS[0].hash)

    expect(repositorySpy.callCount).to.be.equal(1)
    expect(redisGetSpy.callCount).to.be.equal(1)
    expect(redisSetSpy.callCount).to.be.equal(1)

    // Subsequent calls should retrieve results from redis instead
    blockchainResult = await pocketRelayer.loadBlockchain()

    expect(blockchainResult).to.be.ok()
    expect(blockchainResult.blockchainID).to.be.equal(BLOCKCHAINS[0].hash)

    expect(repositorySpy.callCount).to.be.equal(1)
    expect(redisGetSpy.callCount).to.be.equal(2)
    expect(redisSetSpy.callCount).to.be.equal(1)
  })

  it('throws an error when loading an invalid blockchain', async () => {
    await expect(pocketRelayer.loadBlockchain()).to.be.rejectedWith(Error)
  })

  it('checks secret of application when set', () => {
    const pocket = pocketMock.object()

    const encryptor = new Encryptor({ key: DB_ENCRYPTION_KEY })
    const key = 'encrypt123456789120encrypt123456789120'
    const encryptedKey = encryptor.encrypt(key)

    let poktRelayer = new PocketRelayer({
      host: DEFAULT_HOST,
      origin: '',
      userAgent: '',
      pocket,
      pocketConfiguration,
      cherryPicker,
      metricsRecorder,
      syncChecker,
      chainChecker,
      redis,
      databaseEncryptionKey: DB_ENCRYPTION_KEY,
      secretKey: key,
      relayRetries: 0,
      blockchainsRepository: blockchainRepository,
      checkDebug: true,
      altruists: '{}',
      aatPlan: AatPlans.FREEMIUM,
      defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
    })

    const application = {
      id: 'a0fd431dfudjr8002e2s9fi',
      name: 'Test',
      gatewaySettings: {
        secretKey: encryptedKey,
        secretKeyRequired: true,
        whitelistOrigins: [],
        whitelistUserAgents: [],
      },
    }

    const isValidApp = poktRelayer.checkSecretKey(application as unknown as Applications)

    expect(isValidApp).to.be.true()

    poktRelayer = new PocketRelayer({
      host: DEFAULT_HOST,
      origin: '',
      userAgent: '',
      pocket,
      pocketConfiguration,
      cherryPicker,
      metricsRecorder,
      syncChecker,
      chainChecker,
      redis,
      databaseEncryptionKey: DB_ENCRYPTION_KEY,
      secretKey: 'invalid',
      relayRetries: 0,
      blockchainsRepository: blockchainRepository,
      checkDebug: true,
      altruists: '{}',
      aatPlan: AatPlans.FREEMIUM,
      defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
    })

    const isInvalidApp = poktRelayer.checkSecretKey(application as unknown as Applications)

    expect(isInvalidApp).to.be.false()
  })

  it('checks whether items are whitelisted', () => {
    const empty = pocketRelayer.checkWhitelist([], '', '')

    expect(empty).to.be.true()

    const noFieldToCheckAgainst = pocketRelayer.checkWhitelist(['value'], '', '')

    expect(noFieldToCheckAgainst).to.be.false()

    const invalidField = pocketRelayer.checkWhitelist(['value'], 'invalid', '')

    expect(invalidField).to.be.false()

    const explicitPass = pocketRelayer.checkWhitelist(['value'], 'value', 'explicit')

    expect(explicitPass).to.be.true()

    const failExplicitPass = pocketRelayer.checkWhitelist(['value'], 'value around here', 'explicit')

    expect(failExplicitPass).to.be.false()

    const implicitPass = pocketRelayer.checkWhitelist(['value'], 'value around here', '')

    expect(implicitPass).to.be.true()
  })

  describe('sendRelay function (without altruists)', () => {
    let rawData: string

    const createBlockchain = async () => {
      const dbBlockchain = await blockchainRepository.createAll(BLOCKCHAINS)

      expect(dbBlockchain).to.have.length(3)
    }

    // Possible ammount of nodes that a session or blockchain check can return
    type SessionNodeAmount = 0 | 1 | 2 | 3 | 4 | 5

    // Returns mock of chain and sync check with the specified amount of nodes as result
    const mockChainAndSyncChecker = (
      chainCheckNodes: SessionNodeAmount,
      syncCheckNodes: SessionNodeAmount
    ): {
      chainChecker: ChainChecker
      syncChecker: SyncChecker
    } => {
      const mockChainChecker = chainChecker
      const mockSyncChecker = syncChecker
      const maxAmountOfNodes = 5

      sinon.replace(
        mockChainChecker,
        'chainIDFilter',
        ({
          nodes,
          requestID,
          chainCheck,
          chainID,
          blockchainID,
          pocket,
          applicationID,
          applicationPublicKey,
          pocketAAT,
          pocketConfiguration: pocketConfig,
        }: ChainIDFilterOptions): Promise<Node[]> => {
          return Promise.resolve(DEFAULT_NODES.slice(maxAmountOfNodes - chainCheckNodes))
        }
      )

      sinon.replace(
        mockSyncChecker,
        'consensusFilter',
        ({
          nodes,
          requestID,
          syncCheck,
          syncCheckPath,
          syncAllowance,
          blockchainID,
          blockchainSyncBackup,
          applicationID,
          applicationPublicKey,
          pocket,
          pocketAAT,
          pocketConfiguration: pocketConfig,
        }: ConsensusFilterOptions): Promise<Node[]> => {
          return Promise.resolve(DEFAULT_NODES.slice(maxAmountOfNodes - syncCheckNodes))
        }
      )

      return {
        chainChecker: mockChainChecker,
        syncChecker: mockSyncChecker,
      }
    }

    beforeEach(async () => {
      // Default data of pocketJS mock
      rawData = Object.keys(pocketMock.relayResponse)[0]

      await createBlockchain()
    })

    it('sends successful relay response as json', async () => {
      const mock = new PocketMock()

      const { chainChecker: mockChainChecker, syncChecker: mockSyncChecker } = mockChainAndSyncChecker(5, 5)

      const pocket = mock.object()

      const poktRelayer = new PocketRelayer({
        host: 'eth-mainnet',
        origin: '',
        userAgent: '',
        pocket,
        pocketConfiguration,
        cherryPicker,
        metricsRecorder,
        syncChecker: mockSyncChecker,
        chainChecker: mockChainChecker,
        redis,
        databaseEncryptionKey: DB_ENCRYPTION_KEY,
        secretKey: '',
        relayRetries: 0,
        blockchainsRepository: blockchainRepository,
        checkDebug: true,
        altruists: '{}',
        aatPlan: AatPlans.FREEMIUM,
        defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
      })

      const relayResponse = await poktRelayer.sendRelay({
        rawData,
        relayPath: '',
        httpMethod: HTTPMethod.POST,
        application: APPLICATION as unknown as Applications,
        requestID: '1234',
        requestTimeOut: undefined,
        overallTimeOut: undefined,
        relayRetries: 0,
      })
      const expected = JSON.parse(mock.relayResponse[rawData] as string)

      expect(relayResponse).to.be.deepEqual(expected)
    })

    it('sends successful relay response as string', async () => {
      const mock = new PocketMock()

      const { chainChecker: mockChainChecker, syncChecker: mockSyncChecker } = mockChainAndSyncChecker(5, 5)

      mock.relayResponse[rawData] = 'string response'

      const pocket = mock.object()

      const poktRelayer = new PocketRelayer({
        host: 'eth-mainnet-string',
        origin: '',
        userAgent: '',
        pocket,
        pocketConfiguration,
        cherryPicker,
        metricsRecorder,
        syncChecker: mockSyncChecker,
        chainChecker: mockChainChecker,
        redis,
        databaseEncryptionKey: DB_ENCRYPTION_KEY,
        secretKey: '',
        relayRetries: 0,
        blockchainsRepository: blockchainRepository,
        checkDebug: true,
        altruists: '{}',
        aatPlan: AatPlans.FREEMIUM,
        defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
      })

      const relayResponse = await poktRelayer.sendRelay({
        rawData,
        relayPath: '',
        httpMethod: HTTPMethod.POST,
        application: APPLICATION as unknown as Applications,
        requestID: '1234',
        requestTimeOut: undefined,
        overallTimeOut: undefined,
        relayRetries: 0,
      })
      const expected = mock.relayResponse[rawData]

      expect(relayResponse).to.be.deepEqual(expected)
    })

    it('throws an error when provided timeout is exceeded', async () => {
      const mock = new PocketMock()

      mock.fail = true

      const pocket = mock.object()

      const poktRelayer = new PocketRelayer({
        host: 'eth-mainnet',
        origin: '',
        userAgent: '',
        pocket,
        pocketConfiguration,
        cherryPicker,
        metricsRecorder,
        syncChecker,
        chainChecker,
        redis,
        databaseEncryptionKey: DB_ENCRYPTION_KEY,
        secretKey: '',
        relayRetries: 0,
        blockchainsRepository: blockchainRepository,
        checkDebug: true,
        altruists: '{}',
        aatPlan: AatPlans.FREEMIUM,
        defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
      })

      const relayResponse = await poktRelayer.sendRelay({
        rawData,
        relayPath: '',
        httpMethod: HTTPMethod.POST,
        application: APPLICATION as unknown as Applications,
        requestID: '1234',
        requestTimeOut: 0,
        overallTimeOut: 1,
        relayRetries: 1,
      })

      expect(relayResponse).to.be.instanceOf(HttpErrors.GatewayTimeout)
    })

    it('returns relay error on successful relay response that returns error', async () => {
      const mock = new PocketMock()

      mock.relayResponse[rawData] = '{"error": "a relay error"}'

      const pocket = mock.object()

      const poktRelayer = new PocketRelayer({
        host: 'eth-mainnet-x',
        origin: '',
        userAgent: '',
        pocket,
        pocketConfiguration,
        cherryPicker,
        metricsRecorder,
        syncChecker,
        chainChecker,
        redis,
        databaseEncryptionKey: DB_ENCRYPTION_KEY,
        secretKey: '',
        relayRetries: 0,
        blockchainsRepository: blockchainRepository,
        checkDebug: true,
        altruists: '{}',
        aatPlan: AatPlans.FREEMIUM,
        defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
      })

      const relayResponse = await poktRelayer.sendRelay({
        rawData,
        relayPath: '',
        httpMethod: HTTPMethod.POST,
        application: APPLICATION as unknown as Applications,
        requestID: '1234',
        requestTimeOut: undefined,
        overallTimeOut: undefined,
        relayRetries: 0,
      })

      expect(relayResponse).to.be.instanceOf(HttpErrors.GatewayTimeout)
    })

    it('chainIDCheck / syncCheck succeeds', async () => {
      const { chainChecker: mockChainChecker, syncChecker: mockSyncChecker } = mockChainAndSyncChecker(5, 5)

      const mockChainCheckerSpy = sinon.spy(mockChainChecker, 'chainIDFilter')

      const syncCherckerSpy = sinon.spy(mockSyncChecker, 'consensusFilter')

      const pocket = pocketMock.object()

      const poktRelayer = new PocketRelayer({
        host: 'eth-mainnet',
        origin: '',
        userAgent: '',
        pocket,
        pocketConfiguration,
        cherryPicker,
        metricsRecorder,
        syncChecker: mockSyncChecker,
        chainChecker: mockChainChecker,
        redis,
        databaseEncryptionKey: DB_ENCRYPTION_KEY,
        secretKey: 'invalid secret key',
        relayRetries: 0,
        blockchainsRepository: blockchainRepository,
        checkDebug: true,
        altruists: '{}',
        aatPlan: AatPlans.FREEMIUM,
        defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
      })

      const relayResponse = await poktRelayer.sendRelay({
        rawData,
        relayPath: '',
        httpMethod: HTTPMethod.POST,
        application: APPLICATION as unknown as Applications,
        requestID: '1234',
        requestTimeOut: undefined,
        overallTimeOut: undefined,
        relayRetries: 0,
      })

      expect(relayResponse).to.be.deepEqual(JSON.parse(pocketMock.relayResponse[rawData] as string))

      expect(mockChainCheckerSpy.callCount).to.be.equal(1)
      expect(syncCherckerSpy.callCount).to.be.equal(1)
    })

    it('chainIDCheck fails (no nodes returned)', async () => {
      const { chainChecker: mockChainChecker, syncChecker: mockSyncChecker } = mockChainAndSyncChecker(0, 5)

      const mockChainCheckerSpy = sinon.spy(mockChainChecker, 'chainIDFilter')

      const syncCherckerSpy = sinon.spy(mockSyncChecker, 'consensusFilter')

      const pocket = pocketMock.object()

      const poktRelayer = new PocketRelayer({
        host: 'eth-mainnet',
        origin: '',
        userAgent: '',
        pocket,
        pocketConfiguration,
        cherryPicker,
        metricsRecorder,
        syncChecker: mockSyncChecker,
        chainChecker: mockChainChecker,
        redis,
        databaseEncryptionKey: DB_ENCRYPTION_KEY,
        secretKey: 'invalid secret key',
        relayRetries: 0,
        blockchainsRepository: blockchainRepository,
        checkDebug: true,
        altruists: '{}',
        aatPlan: AatPlans.FREEMIUM,
        defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
      })

      const relayResponse = await poktRelayer.sendRelay({
        rawData,
        relayPath: '',
        httpMethod: HTTPMethod.POST,
        application: APPLICATION as unknown as Applications,
        requestID: '1234',
        requestTimeOut: undefined,
        overallTimeOut: undefined,
        relayRetries: 0,
      })

      expect(relayResponse).to.be.instanceOf(Error)

      expect(mockChainCheckerSpy.callCount).to.be.equal(1)
      expect(syncCherckerSpy.callCount).to.be.equal(1)
    })

    it('syncCheck fails (no nodes returned)', async () => {
      const { chainChecker: mockChainChecker, syncChecker: mockSyncChecker } = mockChainAndSyncChecker(5, 0)

      const mockChainCheckerSpy = sinon.spy(mockChainChecker, 'chainIDFilter')
      const syncCherckerSpy = sinon.spy(mockSyncChecker, 'consensusFilter')

      const pocket = pocketMock.object()

      const poktRelayer = new PocketRelayer({
        host: 'eth-mainnet',
        origin: '',
        userAgent: '',
        pocket,
        pocketConfiguration,
        cherryPicker,
        metricsRecorder,
        syncChecker: mockSyncChecker,
        chainChecker: mockChainChecker,
        redis,
        databaseEncryptionKey: DB_ENCRYPTION_KEY,
        secretKey: 'invalid secret key',
        relayRetries: 0,
        blockchainsRepository: blockchainRepository,
        checkDebug: true,
        altruists: '{}',
        aatPlan: AatPlans.FREEMIUM,
        defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
      })

      const relayResponse = await poktRelayer.sendRelay({
        rawData,
        relayPath: '',
        httpMethod: HTTPMethod.POST,
        application: APPLICATION as unknown as Applications,
        requestID: '1234',
        requestTimeOut: undefined,
        overallTimeOut: undefined,
        relayRetries: 0,
      })

      expect(relayResponse).to.be.instanceOf(Error)

      expect(mockChainCheckerSpy.callCount).to.be.equal(1)
      expect(syncCherckerSpy.callCount).to.be.equal(1)
    })

    it('should return an error if exceeded `eth_getLogs` max blocks range (no altruist)', async () => {
      const mock = new PocketMock()

      mock.fail = true

      const pocket = mock.object()

      const poktRelayer = new PocketRelayer({
        host: 'eth-mainnet',
        origin: '',
        userAgent: '',
        pocket,
        pocketConfiguration,
        cherryPicker,
        metricsRecorder,
        syncChecker,
        chainChecker,
        redis,
        databaseEncryptionKey: DB_ENCRYPTION_KEY,
        secretKey: '',
        relayRetries: 0,
        blockchainsRepository: blockchainRepository,
        checkDebug: true,
        altruists: '{}',
        aatPlan: AatPlans.FREEMIUM,
        defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
      })

      rawData =
        '{"method":"eth_getLogs","params":[{"fromBlock":"0x9c5bb6","toBlock":"0x9c82c7","address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff"}],"id":1,"jsonrpc":"2.0"}'

      const relayResponse = (await poktRelayer.sendRelay({
        rawData,
        relayPath: '',
        httpMethod: HTTPMethod.POST,
        application: APPLICATION as unknown as Applications,
        requestID: '1234',
        requestTimeOut: undefined,
        overallTimeOut: undefined,
        relayRetries: 0,
      })) as Error

      expect(relayResponse).to.be.instanceOf(LimitError)
      expect(relayResponse.message).to.match(/You cannot query logs for more than/)
    })

    it('should return an error if `eth_getLogs` call uses "latest" on block params (no altruist)', async () => {
      const mock = new PocketMock()

      mock.fail = true

      const pocket = mock.object()

      const poktRelayer = new PocketRelayer({
        host: 'eth-mainnet',
        origin: '',
        userAgent: '',
        pocket,
        pocketConfiguration,
        cherryPicker,
        metricsRecorder,
        syncChecker,
        chainChecker,
        redis,
        databaseEncryptionKey: DB_ENCRYPTION_KEY,
        secretKey: '',
        relayRetries: 0,
        blockchainsRepository: blockchainRepository,
        checkDebug: true,
        altruists: '{}',
        aatPlan: AatPlans.FREEMIUM,
        defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
      })

      rawData =
        '{"method":"eth_getLogs","params":[{"fromBlock":"latest","toBlock":"latest","address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff"}],"id":1,"jsonrpc":"2.0"}'

      const relayResponse = (await poktRelayer.sendRelay({
        rawData,
        relayPath: '',
        httpMethod: HTTPMethod.POST,
        application: APPLICATION as unknown as Applications,
        requestID: '1234',
        requestTimeOut: undefined,
        overallTimeOut: undefined,
        relayRetries: 0,
      })) as Error

      expect(relayResponse).to.be.instanceOf(LimitError)
      expect(relayResponse.message).to.be.equal(`Please use an explicit block number instead of 'latest'.`)
    })

    it('should succeed if `eth_getLogs` call is within permitted blocks range (no altruist)', async () => {
      const mock = new PocketMock()

      const { chainChecker: mockChainChecker, syncChecker: mockSyncChecker } = mockChainAndSyncChecker(5, 5)

      rawData =
        '{"method":"eth_getLogs","params":[{"fromBlock":"0xc5bdc9","toBlock":"0xc5bdc9","address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff"}],"id":1,"jsonrpc":"2.0"}'

      mock.relayResponse[rawData] =
        '{"jsonrpc":"2.0","id":1,"result":[{"address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff","blockHash":"0x2ad90e24266edd835bb03071c0c0b58ee8356c2feb4576d15b3c2c2b2ef319c5","blockNumber":"0xc5bdc9","data":"0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000767fe9edc9e0df98e07454847909b5e959d7ca0e0000000000000000000000000000000000000000000000019274b259f653fc110000000000000000000000000000000000000000000000104bf2ffa4dcbf8de5","logIndex":"0x4c","removed":false,"topics":["0x0f6672f78a59ba8e5e5b5d38df3ebc67f3c792e2c9259b8d97d7f00dd78ba1b3","0x000000000000000000000000e5feeac09d36b18b3fa757e5cf3f8da6b8e27f4c"],"transactionHash":"0x14430f1e344b5f95ea68a5f4c0538fc732cc97efdc68f6ee0ba20e2c633542f6","transactionIndex":"0x1a"}]}'

      const pocket = mock.object()

      const poktRelayer = new PocketRelayer({
        host: 'eth-mainnet',
        origin: '',
        userAgent: '',
        pocket,
        pocketConfiguration,
        cherryPicker,
        metricsRecorder,
        syncChecker: mockSyncChecker,
        chainChecker: mockChainChecker,
        redis,
        databaseEncryptionKey: DB_ENCRYPTION_KEY,
        secretKey: '',
        relayRetries: 0,
        blockchainsRepository: blockchainRepository,
        checkDebug: true,
        altruists: '{}',
        aatPlan: AatPlans.FREEMIUM,
        defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
      })

      const relayResponse = await poktRelayer.sendRelay({
        rawData,
        relayPath: '',
        httpMethod: HTTPMethod.POST,
        application: APPLICATION as unknown as Applications,
        requestID: '1234',
        requestTimeOut: undefined,
        overallTimeOut: undefined,
        relayRetries: 0,
      })

      expect(relayResponse).to.be.deepEqual(JSON.parse(mock.relayResponse[rawData] as string))
    })

    describe('security checks', () => {
      it('returns forbbiden when secreKey does not match', async () => {
        const gatewaySettings = {
          secretKey: 'y1lhuxbpo7u3hvxzqvesbx7jcjdczw3j',
          secretKeyRequired: true,
          whitelistOrigins: [],
          whitelistUserAgents: [],
        }

        const application = { ...APPLICATION }

        application.gatewaySettings = gatewaySettings

        const pocket = pocketMock.object()

        const poktRelayer = new PocketRelayer({
          host: 'eth-mainnet-x',
          origin: '',
          userAgent: '',
          pocket,
          pocketConfiguration,
          cherryPicker,
          metricsRecorder,
          syncChecker,
          chainChecker,
          redis,
          databaseEncryptionKey: DB_ENCRYPTION_KEY,
          secretKey: 'invalid secret key',
          relayRetries: 0,
          blockchainsRepository: blockchainRepository,
          checkDebug: true,
          altruists: '{}',
          aatPlan: AatPlans.FREEMIUM,
          defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
        })

        try {
          await poktRelayer.sendRelay({
            rawData,
            relayPath: '',
            httpMethod: HTTPMethod.POST,
            application: application as unknown as Applications,
            requestID: '1234',
            requestTimeOut: undefined,
            overallTimeOut: undefined,
            relayRetries: 0,
          })
        } catch (error) {
          expect(error).to.be.instanceOf(HttpErrors.Forbidden)
          expect(error.message).to.be.equal('SecretKey does not match')
        }
      })

      it('returns forbbiden when origins checks fail', async () => {
        const gatewaySettings = {
          secretKey: 'y1lhuxbpo7u3hvxzqvesbx7jcjdczw3j',
          secretKeyRequired: false,
          whitelistOrigins: ['localhost'],
          whitelistUserAgents: [],
        }

        const application = { ...APPLICATION }

        application.gatewaySettings = gatewaySettings

        const pocket = pocketMock.object()

        const invalidOrigin = 'invalid-origin'

        const poktRelayer = new PocketRelayer({
          host: 'eth-mainnet-x',
          origin: invalidOrigin,
          userAgent: '',
          pocket,
          pocketConfiguration,
          cherryPicker,
          metricsRecorder,
          syncChecker,
          chainChecker,
          redis,
          databaseEncryptionKey: DB_ENCRYPTION_KEY,
          secretKey: 'invalid secret key',
          relayRetries: 0,
          blockchainsRepository: blockchainRepository,
          checkDebug: true,
          altruists: '{}',
          aatPlan: AatPlans.FREEMIUM,
          defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
        })

        try {
          await poktRelayer.sendRelay({
            rawData,
            relayPath: '',
            httpMethod: HTTPMethod.POST,
            application: application as unknown as Applications,
            requestID: '1234',
            requestTimeOut: undefined,
            overallTimeOut: undefined,
            relayRetries: 0,
          })
        } catch (error) {
          expect(error).to.be.instanceOf(HttpErrors.Forbidden)
          expect(error.message).to.be.equal('Whitelist Origin check failed: ' + invalidOrigin)
        }
      })

      it('returns forbbiden when user agent checks fail', async () => {
        const gatewaySettings = {
          secretKey: 'y1lhuxbpo7u3hvxzqvesbx7jcjdczw3j',
          secretKeyRequired: false,
          whitelistOrigins: [],
          whitelistUserAgents: ['Mozilla/5.0'],
        }

        const application = { ...APPLICATION }

        application.gatewaySettings = gatewaySettings

        const pocket = pocketMock.object()
        const invalidUserAgent = 'invalid-user-agent'

        const poktRelayer = new PocketRelayer({
          host: 'eth-mainnet-x',
          origin: '',
          userAgent: invalidUserAgent,
          pocket,
          pocketConfiguration,
          cherryPicker,
          metricsRecorder,
          syncChecker,
          chainChecker,
          redis,
          databaseEncryptionKey: DB_ENCRYPTION_KEY,
          secretKey: 'invalid secret key',
          relayRetries: 0,
          blockchainsRepository: blockchainRepository,
          checkDebug: true,
          altruists: '{}',
          aatPlan: AatPlans.FREEMIUM,
          defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
        })

        try {
          await poktRelayer.sendRelay({
            rawData,
            relayPath: '',
            httpMethod: HTTPMethod.POST,
            application: application as unknown as Applications,
            requestID: '1234',
            requestTimeOut: undefined,
            overallTimeOut: undefined,
            relayRetries: 0,
          })
        } catch (error) {
          expect(error).to.be.instanceOf(HttpErrors.Forbidden)
          expect(error.message).to.be.equal('Whitelist User Agent check failed: ' + invalidUserAgent)
        }
      })
    })

    describe('sendRelay function (with altruists)', () => {
      const axiosMock = new MockAdapter(axios)
      const blockNumberData = { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }

      beforeEach(() => {
        axiosMock.reset()
      })

      // Altruist is forced by simulating a chainIDCheck failure
      const getAltruistRelayer = (relayResponse?: string): PocketRelayer => {
        const { chainChecker: mockChainChecker, syncChecker: mockSyncChecker } = mockChainAndSyncChecker(0, 5)
        const pocket = pocketMock.object()

        if (relayResponse) {
          pocketMock.relayResponse[rawData] = relayResponse
        }

        const poktRelayer = new PocketRelayer({
          host: 'eth-mainnet',
          origin: '',
          userAgent: '',
          pocket,
          pocketConfiguration,
          cherryPicker,
          metricsRecorder,
          syncChecker: mockSyncChecker,
          chainChecker: mockChainChecker,
          redis,
          databaseEncryptionKey: DB_ENCRYPTION_KEY,
          secretKey: 'invalid secret key',
          relayRetries: 0,
          blockchainsRepository: blockchainRepository,
          checkDebug: true,
          altruists: JSON.stringify(ALTRUISTS),
          aatPlan: AatPlans.FREEMIUM,
          defaultLogLimitBlocks: DEFAULT_LOG_LIMIT,
        }) as PocketRelayer

        return poktRelayer
      }

      it('sends a relay post request to an altruist node when no session nodes are available', async () => {
        const axiosRelayResponse = JSON.parse(pocketMock.relayResponse[rawData] as string)

        axiosMock.onPost(ALTRUISTS['0021']).reply(200, axiosRelayResponse)

        const altruistRelayer = getAltruistRelayer()

        const relayResponse = await altruistRelayer.sendRelay({
          rawData,
          relayPath: '',
          httpMethod: HTTPMethod.POST,
          application: APPLICATION as unknown as Applications,
          requestID: '1234',
          requestTimeOut: undefined,
          overallTimeOut: undefined,
          relayRetries: 0,
        })

        expect(relayResponse).to.be.deepEqual(axiosRelayResponse)
      })

      it('sends a relay get request to an altruist node when no session nodes are available', async () => {
        const axiosRelayResponse = JSON.parse(pocketMock.relayResponse[rawData] as string)

        axiosMock.onGet(ALTRUISTS['0021']).reply(200, axiosRelayResponse)

        const altruistRelayer = getAltruistRelayer()

        const relayResponse = await altruistRelayer.sendRelay({
          rawData,
          relayPath: '',
          httpMethod: HTTPMethod.GET,
          application: APPLICATION as unknown as Applications,
          requestID: '1234',
          requestTimeOut: undefined,
          overallTimeOut: undefined,
          relayRetries: 0,
        })

        expect(relayResponse).to.be.deepEqual(axiosRelayResponse)
      })

      it('returns a string response from altruists', async () => {
        const stringResponse = 'a string response'

        axiosMock.onGet(ALTRUISTS['0021']).reply(200, stringResponse)

        const altruistRelayer = getAltruistRelayer()

        const relayResponse = await altruistRelayer.sendRelay({
          rawData,
          relayPath: '',
          httpMethod: HTTPMethod.GET,
          application: APPLICATION as unknown as Applications,
          requestID: '1234',
          requestTimeOut: undefined,
          overallTimeOut: undefined,

          relayRetries: 0,
        })

        expect(JSON.parse(relayResponse as string)).to.be.deepEqual(stringResponse)
      })

      it('returns timeout error when fallback fails', async () => {
        axiosMock.onGet(ALTRUISTS['0021']).reply(500, {})

        const altruistRelayer = getAltruistRelayer()

        const relayResponse = await altruistRelayer.sendRelay({
          rawData,
          relayPath: '',
          httpMethod: HTTPMethod.GET,
          application: APPLICATION as unknown as Applications,
          requestID: '1234',
          requestTimeOut: undefined,
          overallTimeOut: undefined,
          relayRetries: 0,
        })

        expect(relayResponse).to.be.instanceOf(HttpErrors.GatewayTimeout)
      })

      it('should return an error if exceeded eth_getLogs max blocks range (using latest)', async () => {
        const blockNumberRespose = {
          jsonrpc: '2.0',
          id: 1,
          result: '0x9c82c7',
        }

        const altruistRelayer = getAltruistRelayer()

        rawData =
          '{"method":"eth_getLogs","params":[{"fromBlock":"0x9c5bb6","address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff"}],"id":1,"jsonrpc":"2.0"}'

        axiosMock.onPost(ALTRUISTS['0021'], blockNumberData).reply(200, blockNumberRespose)

        const relayResponse = (await altruistRelayer.sendRelay({
          rawData,
          relayPath: '',
          httpMethod: HTTPMethod.POST,
          application: APPLICATION as unknown as Applications,
          requestID: '1234',
          requestTimeOut: undefined,
          overallTimeOut: undefined,
          relayRetries: 0,
        })) as Error

        expect(relayResponse).to.be.instanceOf(LimitError)
        expect(relayResponse.message).to.match(/You cannot query logs for more than/)
      })

      it('should succeed if `eth_getLogs` call is within permitted blocks range (using latest)', async () => {
        const blockNumberRespose = {
          jsonrpc: '2.0',
          id: 1,
          result: '0x9c5bb8',
        }

        const mockRelayResponse =
          '{"jsonrpc":"2.0","id":1,"result":[{"address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff","blockHash":"0x2ad90e24266edd835bb03071c0c0b58ee8356c2feb4576d15b3c2c2b2ef319c5","blockNumber":"0xc5bdc9","data":"0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000767fe9edc9e0df98e07454847909b5e959d7ca0e0000000000000000000000000000000000000000000000019274b259f653fc110000000000000000000000000000000000000000000000104bf2ffa4dcbf8de5","logIndex":"0x4c","removed":false,"topics":["0x0f6672f78a59ba8e5e5b5d38df3ebc67f3c792e2c9259b8d97d7f00dd78ba1b3","0x000000000000000000000000e5feeac09d36b18b3fa757e5cf3f8da6b8e27f4c"],"transactionHash":"0x14430f1e344b5f95ea68a5f4c0538fc732cc97efdc68f6ee0ba20e2c633542f6","transactionIndex":"0x1a"}]}'

        rawData =
          '{"method":"eth_getLogs","params":[{"fromBlock":"0x9c5bb6","address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff"}],"id":1,"jsonrpc":"2.0"}'

        const altruistRelayer = getAltruistRelayer(mockRelayResponse)

        axiosMock.onPost(ALTRUISTS['0021'], blockNumberData).reply(200, blockNumberRespose)
        axiosMock.onPost(ALTRUISTS['0021'], JSON.parse(rawData)).reply(200, mockRelayResponse)

        const relayResponse = await altruistRelayer.sendRelay({
          rawData,
          relayPath: '',
          httpMethod: HTTPMethod.POST,
          application: APPLICATION as unknown as Applications,
          requestID: '1234',
          requestTimeOut: undefined,
          overallTimeOut: undefined,
          relayRetries: 0,
        })

        expect(relayResponse).to.be.deepEqual(JSON.parse(mockRelayResponse as string))
      })

      it('should succeed if `eth_getLogs` call is within permitted blocks range (using latest) even with not default value set on db or environment', async () => {
        const blockNumberRespose = {
          jsonrpc: '2.0',
          id: 1,
          result: '0x9c5bb8',
        }

        const mockRelayResponse =
          '{"jsonrpc":"2.0","id":1,"result":[{"address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff","blockHash":"0x2ad90e24266edd835bb03071c0c0b58ee8356c2feb4576d15b3c2c2b2ef319c5","blockNumber":"0xc5bdc9","data":"0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000767fe9edc9e0df98e07454847909b5e959d7ca0e0000000000000000000000000000000000000000000000019274b259f653fc110000000000000000000000000000000000000000000000104bf2ffa4dcbf8de5","logIndex":"0x4c","removed":false,"topics":["0x0f6672f78a59ba8e5e5b5d38df3ebc67f3c792e2c9259b8d97d7f00dd78ba1b3","0x000000000000000000000000e5feeac09d36b18b3fa757e5cf3f8da6b8e27f4c"],"transactionHash":"0x14430f1e344b5f95ea68a5f4c0538fc732cc97efdc68f6ee0ba20e2c633542f6","transactionIndex":"0x1a"}]}'

        rawData =
          '{"method":"eth_getLogs","params":[{"fromBlock":"0x9c5bb6","address":"0xdef1c0ded9bec7f1a1670819833240f027b25eff"}],"id":1,"jsonrpc":"2.0"}'

        const pocket = pocketMock.object()

        if (mockRelayResponse) {
          pocketMock.relayResponse[rawData] = mockRelayResponse
        }

        axiosMock.onPost(ALTRUISTS['0040'], blockNumberData).reply(200, blockNumberRespose)
        axiosMock.onPost(ALTRUISTS['0040'], JSON.parse(rawData)).reply(200, mockRelayResponse)

        const poktRelayer = new PocketRelayer({
          host: 'eth-mainnet-string',
          origin: '',
          userAgent: '',
          pocket,
          pocketConfiguration,
          cherryPicker,
          metricsRecorder,
          syncChecker,
          chainChecker,
          redis,
          databaseEncryptionKey: DB_ENCRYPTION_KEY,
          secretKey: '',
          relayRetries: 0,
          blockchainsRepository: blockchainRepository,
          checkDebug: true,
          altruists: JSON.stringify(ALTRUISTS),
          aatPlan: AatPlans.FREEMIUM,
          defaultLogLimitBlocks: 0,
        }) as PocketRelayer

        const relayResponse = await poktRelayer.sendRelay({
          rawData,
          relayPath: '',
          httpMethod: HTTPMethod.POST,
          application: APPLICATION as unknown as Applications,
          requestID: '1234',
          requestTimeOut: undefined,
          overallTimeOut: undefined,
          relayRetries: 0,
        })

        expect(JSON.parse(relayResponse as string)).to.be.deepEqual(JSON.parse(mockRelayResponse as string))
      })
    })
  })
})
