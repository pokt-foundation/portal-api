import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import RedisMock from 'ioredis-mock'
import { expect, sinon } from '@loopback/testlab'
import { Configuration, Session, RpcError } from '@pokt-network/pocket-js'
import { getPocketConfigOrDefault } from '../../src/config/pocket-config'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { PocketSyncChecker } from '../../src/services/sync-checker-new'
import { MAX_RELAYS_ERROR } from '../../src/utils/constants'
import { hashBlockchainNodes } from '../../src/utils/helpers'
import { metricsRecorderMock } from '../mocks/metrics-recorder'
import { DEFAULT_NODES, PocketMock } from '../mocks/pocketjs'

const logger = require('../../src/services/logger')

const EVM_RELAY_RESPONSE = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0c9c" }'
const SOLANA_RELAY_RESPONSE = '{"jsonrpc":"2.0","result":85377210,"id":1}'
const POCKET_RELAY_RESPONSE = '{"height":35758}'

const ALTRUIST_URL = {
  '0021': 'https://eth-mainnet:pass@backups.example.org:18081',
  '0006': 'https://solana:pass@backups.example.org:18081',
  '0001': 'https://pocket:pass@backups.example.org:18081',
}

const blockchains = {
  '0021': {
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
    syncCheckOptions: {
      body: '{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}',
      resultKey: 'result',
      allowance: 2,
    },
  },
  '0006': {
    hash: '0006',
    ticker: 'SOL',
    networkID: '6',
    network: 'SOL',
    description: 'Solana',
    index: 14,
    blockchain: 'solana-mainnet',
    active: true,
    enforceResult: 'JSON',
    syncCheckOptions: {
      body: '{"jsonrpc": "2.0", "id": 1, "method": "getSlot"}',
      resultKey: 'result',
      allowance: 2,
    },
  },
  '0001': {
    hash: '0001',
    ticker: 'POKT',
    networkID: 'mainnet',
    network: 'POKT-mainnet',
    description: 'Pocket Network Mainnet',
    index: 1,
    blockchain: 'mainnet',
    active: true,
    enforceResult: 'JSON',
    syncCheckOptions: {
      body: '{}',
      resultKey: 'height',
      path: '/v1/query/height',
      allowance: 2,
    },
  },
}

describe('Sync checker service new (unit)', () => {
  let cherryPicker: CherryPicker
  let redis: RedisMock
  let metricsRecorder: MetricsRecorder
  let pocketMock: PocketMock
  let pocketConfiguration: Configuration
  let axiosMock: MockAdapter
  let logSpy: sinon.SinonSpy
  let pocketSession: Session
  let syncChecker: PocketSyncChecker

  before('initialize variables', async () => {
    redis = new RedisMock(0, '')
    cherryPicker = new CherryPicker({ redis, checkDebug: false })
    metricsRecorder = metricsRecorderMock(redis, cherryPicker)
    pocketConfiguration = getPocketConfigOrDefault()
    axiosMock = new MockAdapter(axios)
  })

  afterEach(() => {
    sinon.restore()
    axiosMock.reset()
  })

  beforeEach(async () => {
    logSpy = sinon.spy(logger, 'log')

    // Add relay responses to the Pocket mock class
    pocketMock = new PocketMock(undefined, undefined, pocketConfiguration)
    pocketMock.relayResponse[blockchains['0021'].syncCheckOptions.body] = EVM_RELAY_RESPONSE
    pocketMock.relayResponse[blockchains['0006'].syncCheckOptions.body] = SOLANA_RELAY_RESPONSE
    pocketMock.relayResponse[blockchains['0001'].syncCheckOptions.body] = POCKET_RELAY_RESPONSE
    const pocket = pocketMock.object()

    pocketSession = (await pocket.sessionManager.getCurrentSession(undefined, undefined, undefined)) as Session
    syncChecker = new PocketSyncChecker(pocket, redis, metricsRecorder, pocketSession, 'sync-check')

    //// Add responses to axios mock
    axiosMock.onPost('https://user:pass@backups.example.org:18081/v1/query/node').reply(200, {
      service_url: 'https://localhost:443',
    })
    axiosMock.onPost(ALTRUIST_URL['0021']).reply(200, EVM_RELAY_RESPONSE)
    axiosMock.onPost(ALTRUIST_URL['0006']).reply(200, SOLANA_RELAY_RESPONSE)
    axiosMock
      .onPost(`${ALTRUIST_URL['0001']}${blockchains['0001'].syncCheckOptions.path}`)
      .reply(200, POCKET_RELAY_RESPONSE)

    await redis.flushall()
  })

  after(() => {
    axiosMock.restore()
  })

  it('should be defined', async () => {
    expect(syncChecker).to.be.ok()
  })

  describe('getSyncFromAltruist function', () => {
    it('retrieves sync from altruist', async () => {
      const expectedBlockHeight = 17435804 // 0x10a0c9c to base 10

      const blockHeight = await syncChecker['getSyncFromAltruist'](
        blockchains['0021'].syncCheckOptions,
        ALTRUIST_URL['0021']
      )

      expect(blockHeight).to.be.equal(expectedBlockHeight)
    })

    it('fails retrieving sync from altruist', async () => {
      axiosMock.onPost(ALTRUIST_URL['0021']).networkError()

      const expectedBlockHeight = 0

      const blockHeight = await syncChecker['getSyncFromAltruist'](
        blockchains['0021'].syncCheckOptions,
        ALTRUIST_URL['0021']
      )

      expect(blockHeight).to.be.equal(expectedBlockHeight)
    })
  })

  describe('sync check function', () => {
    it('performs an EVM-sync check successfully', async () => {
      const nodes = DEFAULT_NODES

      const redisGetSpy = sinon.spy(redis, 'get')
      const redisSetSpy = sinon.spy(redis, 'set')

      let syncedNodes = await syncChecker.check(
        nodes,
        blockchains['0021'].syncCheckOptions,
        blockchains['0021'].hash,
        undefined,
        pocketConfiguration,
        ALTRUIST_URL['0021'],
        '1234',
        '5678',
        'abcd'
      )

      expect(syncedNodes).to.have.length(5)

      expect(redisGetSpy.callCount).to.be.equal(12)
      expect(redisSetSpy.callCount).to.be.equal(12)

      // Subsequent calls should retrieve results from redis instead
      syncedNodes = await syncChecker.check(
        nodes,
        blockchains['0021'].syncCheckOptions,
        blockchains['0021'].hash,
        undefined,
        pocketConfiguration,
        ALTRUIST_URL['0021'],
        '1234',
        '5678',
        'abcd'
      )

      expect(redisGetSpy.callCount).to.be.equal(13)
      expect(redisSetSpy.callCount).to.be.equal(12)
    })

    it('performs a non-EVM (Solana) sync check successfully', async () => {
      const nodes = DEFAULT_NODES

      const redisGetSpy = sinon.spy(redis, 'get')
      const redisSetSpy = sinon.spy(redis, 'set')

      let syncedNodes = await syncChecker.check(
        nodes,
        blockchains['0006'].syncCheckOptions,
        blockchains['0006'].hash,
        undefined,
        pocketConfiguration,
        ALTRUIST_URL['0006'],
        '1234',
        '5678',
        'abcd'
      )

      expect(syncedNodes).to.have.length(5)

      expect(redisGetSpy.callCount).to.be.equal(12)
      expect(redisSetSpy.callCount).to.be.equal(12)

      // Subsequent calls should retrieve results from redis instead
      syncedNodes = await syncChecker.check(
        nodes,
        blockchains['0006'].syncCheckOptions,
        blockchains['0006'].hash,
        undefined,
        pocketConfiguration,
        ALTRUIST_URL['0006'],
        '1234',
        '5678',
        'abcd'
      )
      expect(redisGetSpy.callCount).to.be.equal(13)
      expect(redisSetSpy.callCount).to.be.equal(12)
    })

    it('performs a non-EVM (Pocket) sync check successfully', async () => {
      const nodes = DEFAULT_NODES

      const redisGetSpy = sinon.spy(redis, 'get')
      const redisSetSpy = sinon.spy(redis, 'set')

      let syncedNodes = await syncChecker.check(
        nodes,
        blockchains['0001'].syncCheckOptions,
        blockchains['0001'].hash,
        undefined,
        pocketConfiguration,
        ALTRUIST_URL['0001'],
        '1234',
        '5678',
        'abcd'
      )

      expect(syncedNodes).to.have.length(5)

      expect(redisGetSpy.callCount).to.be.equal(12)
      expect(redisSetSpy.callCount).to.be.equal(12)

      // Subsequent calls should retrieve results from redis instead
      syncedNodes = await syncChecker.check(
        nodes,
        blockchains['0001'].syncCheckOptions,
        blockchains['0001'].hash,
        undefined,
        pocketConfiguration,
        ALTRUIST_URL['0001'],
        '1234',
        '5678',
        'abcd'
      )

      expect(redisGetSpy.callCount).to.be.equal(13)
      expect(redisSetSpy.callCount).to.be.equal(12)
    })

    it('fails a sync check due to wrong result key (evm/non-evm)', async () => {
      const nodes = DEFAULT_NODES

      blockchains['0006'].syncCheckOptions.resultKey = 'height' // should be 'result'

      const syncedNodes = await syncChecker.check(
        nodes,
        blockchains['0006'].syncCheckOptions,
        blockchains['0006'].hash,
        undefined,
        pocketConfiguration,
        ALTRUIST_URL['0006'],
        '1234',
        '5678',
        'abcd'
      )

      expect(syncedNodes).to.have.length(5)

      const expectedLog = logSpy.calledWith(
        'error',
        sinon.match((arg: string) => arg.startsWith('SYNC CHECK ERROR'))
      )

      expect(expectedLog).to.be.true()
    })

    it('fails sync check due to altruist and chain error', async () => {
      axiosMock.onPost(ALTRUIST_URL['0021']).networkError()

      const nodes = DEFAULT_NODES

      pocketMock.fail = true

      const syncedNodes = await syncChecker.check(
        nodes,
        blockchains['0021'].syncCheckOptions,
        blockchains['0021'].hash,
        undefined,
        pocketConfiguration,
        ALTRUIST_URL['0021'],
        '1234',
        '5678',
        'abcd'
      )

      expect(syncedNodes).to.have.length(5)

      const expectedLog = logSpy.calledWith(
        'info',
        sinon.match((arg: string) => arg.startsWith('SYNC CHECK ALTRUIST FAILURE'))
      )

      expect(expectedLog).to.be.true()
    })

    it('fails the sync check due to all nodes failing', async () => {
      const nodes = DEFAULT_NODES

      pocketMock.fail = true

      const syncedNodes = await syncChecker.check(
        nodes,
        blockchains['0021'].syncCheckOptions,
        blockchains['0021'].hash,
        undefined,
        pocketConfiguration,
        ALTRUIST_URL['0021'],
        '1234',
        '5678',
        'abcd'
      )

      expect(syncedNodes).to.have.length(0)
    })

    it('pass session sync check but fails due to behind altruist', async () => {
      axiosMock.onPost(ALTRUIST_URL['0021']).reply(200, '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0d00" }') // 100 blocks after the EVM_RELAY_RESPONSE

      const nodes = DEFAULT_NODES

      const syncedNodes = await syncChecker.check(
        nodes,
        blockchains['0021'].syncCheckOptions,
        blockchains['0021'].hash,
        undefined,
        pocketConfiguration,
        ALTRUIST_URL['0021'],
        '1234',
        '5678',
        'abcd'
      )

      expect(syncedNodes).to.have.length(0)
    })

    it('penalize node failing sync check', async () => {
      const nodes = DEFAULT_NODES

      const penalizedNode = '{ "id": 1, "jsonrpc": "2.0", "result": "0x1aa38c" }'

      pocketMock.relayResponse[blockchains['0021'].syncCheckOptions.body] = [
        EVM_RELAY_RESPONSE,
        EVM_RELAY_RESPONSE,
        EVM_RELAY_RESPONSE,
        EVM_RELAY_RESPONSE,
        penalizedNode,
      ]
      syncChecker = new PocketSyncChecker(
        pocketMock.object(),
        redis,
        metricsRecorder,
        pocketSession,
        'sync-check-origin'
      )

      const syncedNodes = await syncChecker.check(
        nodes,
        blockchains['0021'].syncCheckOptions,
        blockchains['0021'].hash,
        undefined,
        pocketConfiguration,
        ALTRUIST_URL['0021'],
        '1234',
        '5678',
        'abcd'
      )

      expect(syncedNodes).to.have.length(4)

      const expectedLog = logSpy.calledWith(
        'info',
        sinon.match((arg: string) => arg.startsWith('SYNC CHECK CHALLENGE'))
      )

      expect(expectedLog).to.be.true()
    })

    it('fails agreement of two highest nodes', async () => {
      const nodes = DEFAULT_NODES

      const highestNode = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0cb0" }' // 17435824

      // Difference is over the allowed sync check
      const secondHighestNode = EVM_RELAY_RESPONSE // 17435804

      pocketMock.relayResponse[blockchains['0021'].syncCheckOptions.body] = [
        highestNode,
        secondHighestNode,
        secondHighestNode,
        secondHighestNode,
        secondHighestNode,
      ]
      syncChecker = new PocketSyncChecker(
        pocketMock.object(),
        redis,
        metricsRecorder,
        pocketSession,
        'sync-check-origin'
      )

      const syncedNodes = await syncChecker.check(
        nodes,
        blockchains['0021'].syncCheckOptions,
        blockchains['0021'].hash,
        undefined,
        pocketConfiguration,
        ALTRUIST_URL['0021'],
        '1234',
        '5678',
        'abcd'
      )

      expect(syncedNodes).to.have.length(1)

      const expectedLog = logSpy.calledWith('error', 'SYNC CHECK ERROR: two highest nodes could not agree on sync')

      expect(expectedLog).to.be.true()
    })

    it('Fails the sync check due to max relays error on a node', async () => {
      const nodes = DEFAULT_NODES

      pocketMock.relayResponse[blockchains['0021'].syncCheckOptions.body] = [
        EVM_RELAY_RESPONSE,
        EVM_RELAY_RESPONSE,
        EVM_RELAY_RESPONSE,
        EVM_RELAY_RESPONSE,
        new RpcError('90', MAX_RELAYS_ERROR),
      ]
      syncChecker = new PocketSyncChecker(
        pocketMock.object(),
        redis,
        metricsRecorder,
        pocketSession,
        'sync-check-origin'
      )

      const syncedNodes = await syncChecker.check(
        nodes,
        blockchains['0021'].syncCheckOptions,
        blockchains['0021'].hash,
        undefined,
        pocketConfiguration,
        ALTRUIST_URL['0021'],
        '1234',
        '5678',
        'abcd'
      )

      expect(syncedNodes).to.have.length(4)

      const removedNode = await redis.smembers(
        `session-${hashBlockchainNodes(blockchains['0021'].hash, pocketSession.sessionNodes)}`
      )

      expect(removedNode).to.have.length(1)
    })
  })
})
