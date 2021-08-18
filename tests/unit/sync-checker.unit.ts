import { SyncChecker } from '../../src/services/sync-checker'
import RedisMock from 'ioredis-mock'
import { metricsRecorderMock } from '../mocks/metricsRecorder'
import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { CherryPicker } from '../../src/services/cherry-picker'
import { DEFAULT_NODES, PocketMock } from '../mocks/pocketjs'
import { Configuration } from '@pokt-network/pocket-js'
import { getPocketConfigOrDefault } from '../../src/config/pocket-config'
import { expect, sinon } from '@loopback/testlab'
import MockAdapter from 'axios-mock-adapter'
import axios from 'axios'

const logger = require('../../src/services/logger')

const SYNC_ALLOWANCE = 5

const DEFAULT_RELAY_RESPONSE = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0c9c" }'

const ALTRUIST_URL = 'https://user:pass@backups.example.org:18081'

const blockchain = {
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
  syncCheck: '{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}',
  syncAllowance: 2,
}

describe('Sync checker service (unit)', () => {
  let syncChecker: SyncChecker
  let cherryPicker: CherryPicker
  let redis: RedisMock
  let metricsRecorder: MetricsRecorder
  let pocketMock: PocketMock
  let pocketConfiguration: Configuration
  let axiosMock: MockAdapter
  let logSpy: sinon.SinonSpy

  before('initialize variables', async () => {
    redis = new RedisMock(0, '')
    cherryPicker = new CherryPicker({ redis, checkDebug: false })
    metricsRecorder = metricsRecorderMock(redis, cherryPicker)
    syncChecker = new SyncChecker(redis, metricsRecorder, SYNC_ALLOWANCE)
    pocketConfiguration = getPocketConfigOrDefault()
    pocketMock = new PocketMock(undefined, undefined, pocketConfiguration)
    axiosMock = new MockAdapter(axios)
  })

  afterEach(() => {
    sinon.restore()
  })

  const clean = async () => {
    logSpy = sinon.spy(logger, 'log')

    axiosMock.reset()

    pocketMock = new PocketMock(undefined, undefined, pocketConfiguration)
    pocketMock.relayResponse[blockchain.syncCheck] = DEFAULT_RELAY_RESPONSE

    await redis.flushall()
  }

  beforeEach(clean)

  it('should be defined', async () => {
    expect(syncChecker).to.be.ok()
  })

  it('updates the configuration consensus to one already set', () => {
    const configuration = getPocketConfigOrDefault({ consensusNodeCount: 9 })

    const expectedConsensusCount = 5

    const newConfig = syncChecker.updateConfigurationConsensus(configuration)

    expect(newConfig.consensusNodeCount).to.be.equal(expectedConsensusCount)
  })

  it('updates the configuration request timeout to one already set', () => {
    const configuration = getPocketConfigOrDefault({ requestTimeout: 10200 })

    const expectedTimeout = 4000

    const newConfig = syncChecker.updateConfigurationTimeout(configuration)

    expect(newConfig.requestTimeOut).to.be.equal(expectedTimeout)
  })

  describe('getNodeSyncLog function', () => {
    it('retrieves the sync logs of a node', async () => {
      const node = DEFAULT_NODES[0]

      const pocket = pocketMock.object()

      const nodeSyncLog = await syncChecker.getNodeSyncLog(
        node,
        '1234',
        blockchain.syncCheck,
        '',
        blockchain.blockchain,
        '',
        '',
        pocket,
        undefined,
        pocketConfiguration
      )

      const expectedBlockHeight = 17435804 // 0x10a0c9c to base 10

      expect(nodeSyncLog.node).to.be.equal(node)
      expect(nodeSyncLog.blockHeight).to.be.equal(expectedBlockHeight)
      expect(nodeSyncLog.blockchain).to.be.equal(blockchain.blockchain)
    })

    it('Fails gracefully on handled error result', async () => {
      const node = DEFAULT_NODES[0]

      pocketMock.fail = true

      const pocket = pocketMock.object()

      const nodeSyncLog = await syncChecker.getNodeSyncLog(
        node,
        '1234',
        blockchain.syncCheck,
        '',
        blockchain.blockchain,
        '',
        '',
        pocket,
        undefined,
        pocketConfiguration
      )

      const expectedBlockHeight = 0

      expect(nodeSyncLog.node).to.be.equal(node)
      expect(nodeSyncLog.blockHeight).to.be.equal(expectedBlockHeight)
      expect(nodeSyncLog.blockchain).to.be.equal(blockchain.blockchain)
    })

    it('Fails gracefully on unhandled error result', async () => {
      const node = DEFAULT_NODES[0]

      // Invalid JSON string
      pocketMock.relayResponse[blockchain.syncCheck] = 'method":eth_blockNumber","id":,"jsonrpc""2.0"}'

      const pocket = pocketMock.object()

      const nodeSyncLog = await syncChecker.getNodeSyncLog(
        node,
        '1234',
        blockchain.syncCheck,
        '',
        blockchain.blockchain,
        '',
        '',
        pocket,
        undefined,
        pocketConfiguration
      )

      const expectedBlockHeight = 0

      expect(nodeSyncLog.node).to.be.equal(node)
      expect(nodeSyncLog.blockHeight).to.be.equal(expectedBlockHeight)
      expect(nodeSyncLog.blockchain).to.be.equal(blockchain.blockchain)
    })
  })

  describe('getSyncFromAltruist function', () => {
    it('retrieves sync from altruist', async () => {
      axiosMock.onPost(ALTRUIST_URL).reply(200, DEFAULT_RELAY_RESPONSE)

      const expectedBlockHeight = 17435804 // 0x10a0c9c to base 10

      const blockHeight = await syncChecker.getSyncFromAltruist(blockchain.syncCheck, '', ALTRUIST_URL)

      expect(blockHeight).to.be.equal(expectedBlockHeight)
    })

    it('fails retrieving sync from altruist', async () => {
      axiosMock.onPost(ALTRUIST_URL).networkError()

      const expectedBlockHeight = 0

      const blockHeight = await syncChecker.getSyncFromAltruist(blockchain.syncCheck, '', ALTRUIST_URL)

      expect(blockHeight).to.be.equal(expectedBlockHeight)
    })
  })

  it('Retrieve the sync logs of a all the nodes in a pocket session', async () => {
    const nodes = DEFAULT_NODES

    const pocketClient = pocketMock.object()

    const nodeLogs = await syncChecker.getNodeSyncLogs(
      nodes,
      '1234',
      blockchain.syncCheck,
      '',
      blockchain.blockchain,
      '',
      '',
      pocketClient,
      undefined,
      pocketConfiguration
    )

    const expectedBlockHeight = 17435804 // 0x10a0c9c to base 10

    nodeLogs.forEach((nodeLog, idx: number) => {
      expect(nodeLog.node).to.be.deepEqual(nodes[idx])
      expect(nodeLog.blockHeight).to.be.equal(expectedBlockHeight)
    })
  })

  describe('consensusFilter function', () => {
    it('performs the sync check successfully', async () => {
      axiosMock.onPost(ALTRUIST_URL).reply(200, DEFAULT_RELAY_RESPONSE)

      const nodes = DEFAULT_NODES

      const pocketClient = pocketMock.object()

      const redisGetSpy = sinon.spy(redis, 'get')
      const redisSetSpy = sinon.spy(redis, 'set')

      let syncedNodes = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchain: blockchain.blockchain,
        syncCheck: blockchain.syncCheck,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: ALTRUIST_URL,
        pocketAAT: undefined,
        pocketConfiguration,
        syncAllowance: SYNC_ALLOWANCE,
        syncCheckPath: '',
      })

      expect(syncedNodes).to.have.length(5)

      expect(redisGetSpy.callCount).to.be.equal(2)
      expect(redisSetSpy.callCount).to.be.equal(7)

      // Subsequent calls should retrieve results from redis instead
      syncedNodes = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchain: blockchain.blockchain,
        syncCheck: blockchain.syncCheck,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: ALTRUIST_URL,
        pocketAAT: undefined,
        pocketConfiguration,
        syncAllowance: SYNC_ALLOWANCE,
        syncCheckPath: '',
      })

      expect(redisGetSpy.callCount).to.be.equal(3)
      expect(redisSetSpy.callCount).to.be.equal(7)
    })

    it('fails sync check due to altruist and chain error', async () => {
      axiosMock.onPost(ALTRUIST_URL).networkError()

      const nodes = DEFAULT_NODES

      pocketMock.fail = true

      const pocketClient = pocketMock.object()

      const syncedNodes = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchain: blockchain.blockchain,
        syncCheck: blockchain.syncCheck,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: ALTRUIST_URL,
        pocketAAT: undefined,
        pocketConfiguration,
        syncAllowance: SYNC_ALLOWANCE,
        syncCheckPath: '',
      })

      expect(syncedNodes).to.have.length(5)

      const expectedLog = logSpy.calledWith(
        'info',
        sinon.match((arg: string) => arg.startsWith('SYNC CHECK ALTRUIST FAILURE'))
      )

      expect(expectedLog).to.be.true()
    })

    it('fails the sync check due to all nodes failing', async () => {
      axiosMock.onPost(ALTRUIST_URL).reply(200, DEFAULT_RELAY_RESPONSE)

      const nodes = DEFAULT_NODES

      pocketMock.fail = true

      const pocketClient = pocketMock.object()

      const syncedNodes = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchain: blockchain.blockchain,
        syncCheck: blockchain.syncCheck,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: ALTRUIST_URL,
        pocketAAT: undefined,
        pocketConfiguration,
        syncAllowance: SYNC_ALLOWANCE,
        syncCheckPath: '',
      })

      expect(syncedNodes).to.have.length(0)
    })

    it('pass session sync check but fails due to behind altruist', async () => {
      axiosMock.onPost(ALTRUIST_URL).reply(200, '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0d00" }') // 100 blocks after the DEFAULT_RELAY_RESPONSE

      const nodes = DEFAULT_NODES

      const pocketClient = pocketMock.object()

      const syncedNodes = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchain: blockchain.blockchain,
        syncCheck: blockchain.syncCheck,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: ALTRUIST_URL,
        pocketAAT: undefined,
        pocketConfiguration,
        syncAllowance: SYNC_ALLOWANCE,
        syncCheckPath: '',
      })

      expect(syncedNodes).to.have.length(0)
    })

    it('penalize node failing sync check', async () => {
      axiosMock.onPost(ALTRUIST_URL).reply(200, DEFAULT_RELAY_RESPONSE)

      const nodes = DEFAULT_NODES

      const penalizedNode = '{ "id": 1, "jsonrpc": "2.0", "result": "0x1aa38c" }'

      pocketMock.relayResponse[blockchain.syncCheck] = [
        DEFAULT_RELAY_RESPONSE,
        DEFAULT_RELAY_RESPONSE,
        DEFAULT_RELAY_RESPONSE,
        DEFAULT_RELAY_RESPONSE,
        penalizedNode,
      ]

      const pocketClient = pocketMock.object()

      const syncedNodes = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchain: blockchain.blockchain,
        syncCheck: blockchain.syncCheck,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: ALTRUIST_URL,
        pocketAAT: undefined,
        pocketConfiguration,
        syncAllowance: SYNC_ALLOWANCE,
        syncCheckPath: '',
      })

      expect(syncedNodes).to.have.length(4)

      const expectedLog = logSpy.calledWith(
        'info',
        sinon.match((arg: string) => arg.startsWith('SYNC CHECK CHALLENGE'))
      )

      expect(expectedLog).to.be.true()
    })

    it('fails agreement of two highest nodes', async () => {
      axiosMock.onPost(ALTRUIST_URL).reply(200, DEFAULT_RELAY_RESPONSE)

      const nodes = DEFAULT_NODES

      const highestNode = DEFAULT_RELAY_RESPONSE // 17435804

      // Difference is over the allowed sync check
      const secondHighestNode = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0c7e" }' // 17435774

      pocketMock.relayResponse[blockchain.syncCheck] = [
        highestNode,
        secondHighestNode,
        secondHighestNode,
        secondHighestNode,
        secondHighestNode,
      ]

      const pocketClient = pocketMock.object()

      const syncedNodes = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchain: blockchain.blockchain,
        syncCheck: blockchain.syncCheck,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: ALTRUIST_URL,
        pocketAAT: undefined,
        pocketConfiguration,
        syncAllowance: SYNC_ALLOWANCE,
        syncCheckPath: '',
      })

      expect(syncedNodes).to.have.length(1)

      const expectedLog = logSpy.calledWith('error', 'SYNC CHECK ERROR: two highest nodes could not agree on sync')

      expect(expectedLog).to.be.true()
    })
  })
})
