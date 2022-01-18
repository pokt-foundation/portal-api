import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import RedisMock from 'ioredis-mock'
import { expect, sinon } from '@loopback/testlab'
import { Configuration, Session, RpcError } from '@pokt-network/pocket-js'
import { getPocketConfigOrDefault } from '../../src/config/pocket-config'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { SyncChecker } from '../../src/services/sync-checker'
import { MAX_RELAYS_ERROR } from '../../src/utils/constants'
import { hashBlockchainNodes } from '../../src/utils/helpers'
import { metricsRecorderMock } from '../mocks/metrics-recorder'
import { DEFAULT_NODES, PocketMock } from '../mocks/pocketjs'

const logger = require('../../src/services/logger')

const DEFAULT_SYNC_ALLOWANCE = 5

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
    blockchainAliases: ['eth-mainnet'],
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
    blockchainAliases: ['solana-mainnet'],
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
    blockchainAliases: ['mainnet'],
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

describe('Sync checker service (unit)', () => {
  let syncChecker: SyncChecker
  let cherryPicker: CherryPicker
  let redis: RedisMock
  let metricsRecorder: MetricsRecorder
  let pocketMock: PocketMock
  let pocketConfiguration: Configuration
  let axiosMock: MockAdapter
  let logSpy: sinon.SinonSpy

  const origin = 'unit-test'

  before('initialize variables', async () => {
    redis = new RedisMock(0, '')
    cherryPicker = new CherryPicker({ redis, checkDebug: false })
    metricsRecorder = metricsRecorderMock(redis, cherryPicker)
    syncChecker = new SyncChecker(redis, metricsRecorder, DEFAULT_SYNC_ALLOWANCE, origin)
    pocketConfiguration = getPocketConfigOrDefault()
    pocketMock = new PocketMock()
    axiosMock = new MockAdapter(axios)
  })

  afterEach(() => {
    sinon.restore()
    axiosMock.reset()
  })

  beforeEach(async () => {
    logSpy = sinon.spy(logger, 'log')

    axiosMock.reset()

    axiosMock.onPost('https://user:pass@backups.example.org:18081/v1/query/node').reply(200, {
      service_url: 'https://localhost:443',
    })

    // Add relay responses to the Pocket mock class
    pocketMock = new PocketMock(undefined, undefined, pocketConfiguration)
    pocketMock.relayResponse[blockchains['0021'].syncCheckOptions.body] = EVM_RELAY_RESPONSE
    pocketMock.relayResponse[blockchains['0006'].syncCheckOptions.body] = SOLANA_RELAY_RESPONSE
    pocketMock.relayResponse[blockchains['0001'].syncCheckOptions.body] = POCKET_RELAY_RESPONSE

    //// Add responses to axios mock
    axiosMock.onPost(ALTRUIST_URL['0021']).reply(200, EVM_RELAY_RESPONSE)
    axiosMock.onPost(ALTRUIST_URL['0006']).reply(200, SOLANA_RELAY_RESPONSE)
    axiosMock.onPost(ALTRUIST_URL['0001']).reply(200, POCKET_RELAY_RESPONSE)

    await redis.flushall()
  })

  after(() => {
    axiosMock.restore()
  })

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
        blockchains['0021'].syncCheckOptions,
        blockchains['0021'].hash,
        '',
        '',
        pocket,
        undefined,
        pocketConfiguration,
        undefined
      )

      const expectedBlockHeight = 17435804 // 0x10a0c9c to base 10

      expect(nodeSyncLog.node).to.be.equal(node)
      expect(nodeSyncLog.blockHeight).to.be.equal(expectedBlockHeight)
      expect(nodeSyncLog.blockchainID).to.be.equal(blockchains['0021'].hash)
    })

    it('Fails gracefully on handled error result', async () => {
      const node = DEFAULT_NODES[0]

      pocketMock.fail = true

      const pocket = pocketMock.object()

      const nodeSyncLog = await syncChecker.getNodeSyncLog(
        node,
        '1234',
        blockchains['0021'].syncCheckOptions,
        blockchains['0021'].hash,
        '',
        '',
        pocket,
        undefined,
        pocketConfiguration,
        undefined
      )

      const expectedBlockHeight = 0

      expect(nodeSyncLog.node).to.be.equal(node)
      expect(nodeSyncLog.blockHeight).to.be.equal(expectedBlockHeight)
      expect(nodeSyncLog.blockchainID).to.be.equal(blockchains['0021'].hash)
    })

    it('Fails gracefully on unhandled error result', async () => {
      const node = DEFAULT_NODES[0]

      // Invalid JSON string
      pocketMock.relayResponse[blockchains['0021'].syncCheckOptions.body] =
        'method":eth_blockNumber","id":,"jsonrpc""2.0"}'

      const pocket = pocketMock.object()

      const nodeSyncLog = await syncChecker.getNodeSyncLog(
        node,
        '1234',
        blockchains['0021'].syncCheckOptions,
        blockchains['0021'].hash,
        '',
        '',
        pocket,
        undefined,
        pocketConfiguration,
        undefined
      )

      const expectedBlockHeight = 0

      expect(nodeSyncLog.node).to.be.equal(node)
      expect(nodeSyncLog.blockHeight).to.be.equal(expectedBlockHeight)
      expect(nodeSyncLog.blockchainID).to.be.equal(blockchains['0021'].hash)
    })
  })

  describe('getSyncFromAltruist function', () => {
    it('retrieves sync from altruist', async () => {
      const expectedBlockHeight = 17435804 // 0x10a0c9c to base 10

      const blockHeight = await syncChecker.getSyncFromAltruist(
        blockchains['0021'].syncCheckOptions,
        ALTRUIST_URL['0021']
      )

      expect(blockHeight).to.be.equal(expectedBlockHeight)
    })

    it('fails retrieving sync from altruist', async () => {
      axiosMock.onPost(ALTRUIST_URL['0021']).networkError()

      const expectedBlockHeight = 0

      const blockHeight = await syncChecker.getSyncFromAltruist(
        blockchains['0021'].syncCheckOptions,
        ALTRUIST_URL['0021']
      )

      expect(blockHeight).to.be.equal(expectedBlockHeight)
    })
  })

  it('Retrieve the sync logs of a all the nodes in a pocket session', async () => {
    const nodes = DEFAULT_NODES

    const pocketClient = pocketMock.object()

    const nodeLogs = await syncChecker.getNodeSyncLogs(
      nodes,
      '1234',
      blockchains['0021'].syncCheckOptions,
      blockchains['0021'].hash,
      '',
      '',
      pocketClient,
      undefined,
      pocketConfiguration,
      '',
      undefined
    )

    const expectedBlockHeight = 17435804 // 0x10a0c9c to base 10

    nodeLogs.forEach((nodeLog, idx: number) => {
      expect(nodeLog.node).to.be.deepEqual(nodes[idx])
      expect(nodeLog.blockHeight).to.be.equal(expectedBlockHeight)
    })
  })

  describe('consensusFilter function', () => {
    it('performs an EVM-sync check successfully', async () => {
      const nodes = DEFAULT_NODES

      const pocketClient = pocketMock.object()

      const redisGetSpy = sinon.spy(redis, 'get')
      const redisSetSpy = sinon.spy(redis, 'set')

      let syncedNodes = (
        await syncChecker.consensusFilter({
          nodes,
          requestID: '1234',
          blockchainID: blockchains['0021'].hash,
          syncCheckOptions: blockchains['0021'].syncCheckOptions,
          pocket: pocketClient,
          applicationID: '',
          applicationPublicKey: '',
          blockchainSyncBackup: ALTRUIST_URL['0021'],
          pocketAAT: undefined,
          pocketConfiguration,
          pocketSession: (await pocketClient.sessionManager.getCurrentSession(
            undefined,
            undefined,
            undefined,
            undefined
          )) as Session,
        })
      ).nodes

      expect(syncedNodes).to.have.length(5)

      expect(redisGetSpy.callCount).to.be.equal(12)
      expect(redisSetSpy.callCount).to.be.equal(12)

      // Subsequent calls should retrieve results from redis instead
      syncedNodes = (
        await syncChecker.consensusFilter({
          nodes,
          requestID: '1234',
          blockchainID: blockchains['0021'].hash,
          syncCheckOptions: blockchains['0021'].syncCheckOptions,
          pocket: pocketClient,
          applicationID: '',
          applicationPublicKey: '',
          blockchainSyncBackup: ALTRUIST_URL['0021'],
          pocketAAT: undefined,
          pocketConfiguration,
          pocketSession: (await pocketClient.sessionManager.getCurrentSession(
            undefined,
            undefined,
            undefined,
            undefined
          )) as Session,
        })
      ).nodes

      expect(redisGetSpy.callCount).to.be.equal(13)
      expect(redisSetSpy.callCount).to.be.equal(12)
    })

    it('performs a non-EVM (Solana) sync check successfully', async () => {
      const nodes = DEFAULT_NODES

      const pocketClient = pocketMock.object()

      const redisGetSpy = sinon.spy(redis, 'get')
      const redisSetSpy = sinon.spy(redis, 'set')

      let syncedNodes = (
        await syncChecker.consensusFilter({
          nodes,
          requestID: '1234',
          blockchainID: blockchains['0006'].hash,
          syncCheckOptions: blockchains['0006'].syncCheckOptions,
          pocket: pocketClient,
          applicationID: '',
          applicationPublicKey: '',
          blockchainSyncBackup: ALTRUIST_URL['0006'],
          pocketAAT: undefined,
          pocketConfiguration,
          pocketSession: (await pocketClient.sessionManager.getCurrentSession(
            undefined,
            undefined,
            undefined,
            undefined
          )) as Session,
        })
      ).nodes

      expect(syncedNodes).to.have.length(5)

      expect(redisGetSpy.callCount).to.be.equal(12)
      expect(redisSetSpy.callCount).to.be.equal(12)

      // Subsequent calls should retrieve results from redis instead
      syncedNodes = (
        await syncChecker.consensusFilter({
          nodes,
          requestID: '1234',
          blockchainID: blockchains['0006'].hash,
          syncCheckOptions: blockchains['0006'].syncCheckOptions,
          pocket: pocketClient,
          applicationID: '',
          applicationPublicKey: '',
          blockchainSyncBackup: ALTRUIST_URL['0006'],
          pocketAAT: undefined,
          pocketConfiguration,
          pocketSession: (await pocketClient.sessionManager.getCurrentSession(
            undefined,
            undefined,
            undefined,
            undefined
          )) as Session,
        })
      ).nodes

      expect(redisGetSpy.callCount).to.be.equal(13)
      expect(redisSetSpy.callCount).to.be.equal(12)
    })

    it('performs a non-EVM (Pocket) sync check successfully', async () => {
      const nodes = DEFAULT_NODES

      const pocketClient = pocketMock.object()

      const redisGetSpy = sinon.spy(redis, 'get')
      const redisSetSpy = sinon.spy(redis, 'set')

      let syncedNodes = (
        await syncChecker.consensusFilter({
          nodes,
          requestID: '1234',
          blockchainID: blockchains['0001'].hash,
          syncCheckOptions: blockchains['0001'].syncCheckOptions,
          pocket: pocketClient,
          applicationID: '',
          applicationPublicKey: '',
          blockchainSyncBackup: ALTRUIST_URL['0001'],
          pocketAAT: undefined,
          pocketConfiguration,
          pocketSession: (await pocketClient.sessionManager.getCurrentSession(
            undefined,
            undefined,
            undefined,
            undefined
          )) as Session,
        })
      ).nodes

      expect(syncedNodes).to.have.length(5)

      expect(redisGetSpy.callCount).to.be.equal(12)
      expect(redisSetSpy.callCount).to.be.equal(12)

      // Subsequent calls should retrieve results from redis instead
      syncedNodes = (
        await syncChecker.consensusFilter({
          nodes,
          requestID: '1234',
          blockchainID: blockchains['0001'].hash,
          syncCheckOptions: blockchains['0001'].syncCheckOptions,
          pocket: pocketClient,
          applicationID: '',
          applicationPublicKey: '',
          blockchainSyncBackup: ALTRUIST_URL['0001'],
          pocketAAT: undefined,
          pocketConfiguration,
          pocketSession: (await pocketClient.sessionManager.getCurrentSession(
            undefined,
            undefined,
            undefined,
            undefined
          )) as Session,
        })
      ).nodes

      expect(redisGetSpy.callCount).to.be.equal(13)
      expect(redisSetSpy.callCount).to.be.equal(12)
    })

    it('fails a sync check due to wrong result key (evm/non-evm)', async () => {
      const nodes = DEFAULT_NODES

      const pocketClient = pocketMock.object()

      blockchains['0006'].syncCheckOptions.resultKey = 'height' // should be 'result'

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0006'].hash,
        syncCheckOptions: blockchains['0006'].syncCheckOptions,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: ALTRUIST_URL['0006'],
        pocketAAT: undefined,
        pocketConfiguration,
        pocketSession: (await pocketClient.sessionManager.getCurrentSession(
          undefined,
          undefined,
          undefined,
          undefined
        )) as Session,
      })

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

      const pocketClient = pocketMock.object()

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0021'].hash,
        syncCheckOptions: blockchains['0021'].syncCheckOptions,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: ALTRUIST_URL['0021'],
        pocketAAT: undefined,
        pocketConfiguration,
        pocketSession: (await pocketClient.sessionManager.getCurrentSession(
          undefined,
          undefined,
          undefined,
          undefined
        )) as Session,
      })

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

      const pocketClient = pocketMock.object()

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0021'].hash,
        syncCheckOptions: blockchains['0021'].syncCheckOptions,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: ALTRUIST_URL['0021'],
        pocketAAT: undefined,
        pocketConfiguration,
        pocketSession: (await pocketClient.sessionManager.getCurrentSession(
          undefined,
          undefined,
          undefined,
          undefined
        )) as Session,
      })

      expect(syncedNodes).to.have.length(0)
    })

    it('pass session sync check but fails due to behind altruist', async () => {
      axiosMock.onPost(ALTRUIST_URL['0021']).reply(200, '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0d00" }') // 100 blocks after the EVM_RELAY_RESPONSE

      const nodes = DEFAULT_NODES

      const pocketClient = pocketMock.object()

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0021'].hash,
        syncCheckOptions: blockchains['0021'].syncCheckOptions,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: ALTRUIST_URL['0021'],
        pocketAAT: undefined,
        pocketConfiguration,
        pocketSession: (await pocketClient.sessionManager.getCurrentSession(
          undefined,
          undefined,
          undefined,
          undefined
        )) as Session,
      })

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

      const pocketClient = pocketMock.object()

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0021'].hash,
        syncCheckOptions: blockchains['0021'].syncCheckOptions,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: ALTRUIST_URL['0021'],
        pocketAAT: undefined,
        pocketConfiguration,
        pocketSession: (await pocketClient.sessionManager.getCurrentSession(
          undefined,
          undefined,
          undefined,
          undefined
        )) as Session,
      })

      expect(syncedNodes).to.have.length(4)

      const expectedLog = logSpy.calledWith(
        'info',
        sinon.match((arg: string) => arg.startsWith('SYNC CHECK CHALLENGE'))
      )

      expect(expectedLog).to.be.true()
    })

    it('fails agreement of two highest nodes', async () => {
      const nodes = DEFAULT_NODES

      const highestNode = EVM_RELAY_RESPONSE // 17435804

      // Difference is over the allowed sync check
      const secondHighestNode = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0c7e" }' // 17435774

      pocketMock.relayResponse[blockchains['0021'].syncCheckOptions.body] = [
        highestNode,
        secondHighestNode,
        secondHighestNode,
        secondHighestNode,
        secondHighestNode,
      ]

      const pocketClient = pocketMock.object()

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0021'].hash,
        syncCheckOptions: blockchains['0021'].syncCheckOptions,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: ALTRUIST_URL['0021'],
        pocketAAT: undefined,
        pocketConfiguration,
        pocketSession: (await pocketClient.sessionManager.getCurrentSession(
          undefined,
          undefined,
          undefined,
          undefined
        )) as Session,
      })

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
      const pocketClient = pocketMock.object()

      const pocketSession = (await pocketClient.sessionManager.getCurrentSession(
        undefined,
        undefined,
        undefined,
        undefined
      )) as Session

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0021'].hash,
        syncCheckOptions: blockchains['0021'].syncCheckOptions,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: ALTRUIST_URL['0021'],
        pocketAAT: undefined,
        pocketConfiguration,
        pocketSession,
      })

      expect(syncedNodes).to.have.length(4)

      const removedNode = await redis.smembers(
        `session-${hashBlockchainNodes(blockchains['0021'].hash, pocketSession.sessionNodes)}`
      )

      expect(removedNode).to.have.length(1)
    })
  })
})
