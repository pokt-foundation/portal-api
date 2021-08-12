import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import RedisMock from 'ioredis-mock'
import { Encryptor } from 'strong-cryptor'
import { HttpErrors } from '@loopback/rest'
import { expect, sinon } from '@loopback/testlab'
import { HTTPMethod, Configuration, Node } from '@pokt-network/pocket-js'

import AatPlans from '../../src/config/aat-plans.json'
import { DEFAULT_POCKET_CONFIG } from '../../src/config/pocket-config'
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

const DB_ENCRYPTION_KEY = '00000000000000000000000000000000'

const DEFAULT_HOST = 'mainnet'

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

const ALTRUISTS = {
  '0021': 'https://user:pass@backups.example.org:18081',
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

  before('initialize variables', async () => {
    redis = new RedisMock(0, '')
    cherryPicker = new CherryPicker({ redis, checkDebug: false })
    metricsRecorder = metricsRecorderMock(redis, cherryPicker)
    chainChecker = new ChainChecker(redis, metricsRecorder)
    syncChecker = new SyncChecker(redis, metricsRecorder, 5)
    blockchainRepository = new BlockchainsRepository(gatewayTestDB)

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
    })
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
    expect(blockchainResult.blockchain).to.be.equal(BLOCKCHAINS[0].hash)

    expect(repositorySpy.callCount).to.be.equal(1)
    expect(redisGetSpy.callCount).to.be.equal(1)
    expect(redisSetSpy.callCount).to.be.equal(1)

    // Subsequent calls should retrieve results from redis instead
    blockchainResult = await pocketRelayer.loadBlockchain()

    expect(blockchainResult).to.be.ok()
    expect(blockchainResult.blockchain).to.be.equal(BLOCKCHAINS[0].hash)

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

  describe('sendRelay function', () => {
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
          blockchain,
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
          syncAllowance = 5,
          blockchain,
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
      const relayResponse = await pocketRelayer.sendRelay({
        rawData,
        relayPath: '',
        httpMethod: HTTPMethod.POST,
        application: APPLICATION as unknown as Applications,
        requestID: '1234',
        requestTimeOut: undefined,
        overallTimeOut: undefined,
        relayRetries: 0,
      })
      const expected = JSON.parse(pocketMock.relayResponse[rawData] as string)

      expect(relayResponse).to.be.deepEqual(expected)
    })

    it('sends successful relay response as string', async () => {
      const mock = new PocketMock()

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
        host: 'mainnet',
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
        host: 'mainnet',
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

      const mockCheckerSpy = sinon.spy(mockChainChecker, 'chainIDFilter')

      const syncCherckerSpy = sinon.spy(syncChecker, 'consensusFilter')

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

      expect(mockCheckerSpy.callCount).to.be.equal(1)
      expect(syncCherckerSpy.callCount).to.be.equal(1)
    })

    it('chainIDCheck fails (no nodes returned)', async () => {
      const { chainChecker: mockChainChecker, syncChecker: mockSyncChecker } = mockChainAndSyncChecker(0, 5)

      const mockCheckerSpy = sinon.spy(mockChainChecker, 'chainIDFilter')

      const syncCherckerSpy = sinon.spy(syncChecker, 'consensusFilter')

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

      expect(mockCheckerSpy.callCount).to.be.equal(1)
      expect(syncCherckerSpy.callCount).to.be.equal(0)
    })

    it('syncCheck fails (no nodes returned)', async () => {
      const { chainChecker: mockChainChecker, syncChecker: mockSyncChecker } = mockChainAndSyncChecker(5, 0)

      const mockCheckerSpy = sinon.spy(mockChainChecker, 'chainIDFilter')

      const syncCherckerSpy = sinon.spy(syncChecker, 'consensusFilter')

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

      expect(mockCheckerSpy.callCount).to.be.equal(1)
      expect(syncCherckerSpy.callCount).to.be.equal(1)
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
          host: 'mainnet',
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
          host: 'mainnet',
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
          host: 'mainnet',
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

    describe('altruist nodes', () => {
      const axiosMock = new MockAdapter(axios)

      beforeEach(axiosMock.reset)

      // Altruist is forced by simulating a chainIDCheck failure
      const getAltruistRelayer = (): PocketRelayer => {
        const { chainChecker: mockChainChecker, syncChecker: mockSyncChecker } = mockChainAndSyncChecker(0, 5)

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
          altruists: JSON.stringify(ALTRUISTS),
          aatPlan: AatPlans.FREEMIUM,
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
    })
  })
})
