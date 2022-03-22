import { EvidenceSealedError } from '@pokt-foundation/pocketjs-relayer'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import RedisMock from 'ioredis-mock'
import { expect, sinon } from '@loopback/testlab'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { SyncChecker } from '../../src/services/sync-checker'
import { metricsRecorderMock } from '../mocks/metrics-recorder'
import { DEFAULT_NODES, PocketMock } from '../mocks/pocketjs'

const logger = require('../../src/services/logger')

const DEFAULT_SYNC_ALLOWANCE = 5

const EVM_RELAY_RESPONSE = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0c9c" }'
const SOLANA_RELAY_RESPONSE = '{"jsonrpc":"2.0","result":85377210,"id":1}'
const POCKET_RELAY_RESPONSE = '{"height":35758}'

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
      path: '',
      allowance: 5,
    },
    altruist: 'https://eth-mainnet:pass@backups.example.org:18081',
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
      path: '',
      allowance: 2,
    },
    altruist: 'https://solana:pass@backups.example.org:18081',
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
    altruist: 'https://pocket:pass@backups.example.org:18081',
  },
}

describe('Sync checker service (unit)', () => {
  let syncChecker: SyncChecker
  let cherryPicker: CherryPicker
  let redis: RedisMock
  let metricsRecorder: MetricsRecorder
  let pocketMock: PocketMock
  let axiosMock: MockAdapter
  let logSpy: sinon.SinonSpy

  const origin = 'unit-test'

  before('initialize variables', async () => {
    redis = new RedisMock(0, '')
    cherryPicker = new CherryPicker({ redis, checkDebug: false })
    metricsRecorder = metricsRecorderMock(redis, cherryPicker)
    syncChecker = new SyncChecker(redis, metricsRecorder, DEFAULT_SYNC_ALLOWANCE, origin)
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
    pocketMock = new PocketMock()
    pocketMock.relayResponse[blockchains['0021'].syncCheckOptions.body] = EVM_RELAY_RESPONSE
    pocketMock.relayResponse[blockchains['0006'].syncCheckOptions.body] = SOLANA_RELAY_RESPONSE
    pocketMock.relayResponse[blockchains['0001'].syncCheckOptions.body] = POCKET_RELAY_RESPONSE

    //// Add responses to axios mock
    axiosMock
      .onPost(blockchains['0021']?.altruist.concat(blockchains['0021'].syncCheckOptions.path))
      .reply(200, EVM_RELAY_RESPONSE)
    axiosMock
      .onPost(blockchains['0006']?.altruist.concat(blockchains['0006'].syncCheckOptions.path))
      .reply(200, SOLANA_RELAY_RESPONSE)
    axiosMock
      .onPost(blockchains['0001']?.altruist.concat(blockchains['0001'].syncCheckOptions.path))
      .reply(200, POCKET_RELAY_RESPONSE)

    await redis.flushall()
  })

  after(() => {
    axiosMock.restore()
  })

  it('should be defined', async () => {
    expect(syncChecker).to.be.ok()
  })

  describe('getNodeSyncLog function', () => {
    it('retrieves the sync logs of a node', async () => {
      const node = DEFAULT_NODES[0]

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const nodeSyncLog = await syncChecker.getNodeSyncLog(
        node,
        '1234',
        blockchains['0021'].syncCheckOptions,
        blockchains['0021'].hash,
        '',
        '',
        relayer,
        undefined,
        session
      )

      const expectedBlockHeight = 17435804 // 0x10a0c9c to base 10

      expect(nodeSyncLog.node).to.be.equal(node)
      expect(nodeSyncLog.blockHeight).to.be.equal(expectedBlockHeight)
      expect(nodeSyncLog.blockchainID).to.be.equal(blockchains['0021'].hash)
    })

    it('Fails gracefully on handled error result', async () => {
      const node = DEFAULT_NODES[0]

      pocketMock.fail = true

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const nodeSyncLog = await syncChecker.getNodeSyncLog(
        node,
        '1234',
        blockchains['0021'].syncCheckOptions,
        blockchains['0021'].hash,
        '',
        '',
        relayer,
        undefined,
        session
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

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const nodeSyncLog = await syncChecker.getNodeSyncLog(
        node,
        '1234',
        blockchains['0021'].syncCheckOptions,
        blockchains['0021'].hash,
        '',
        '',
        relayer,
        undefined,
        session
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
        blockchains['0021']?.altruist
      )

      expect(blockHeight).to.be.equal(expectedBlockHeight)
    })

    it('fails retrieving sync from altruist', async () => {
      axiosMock.onPost(blockchains['0021']?.altruist).networkError()

      const expectedBlockHeight = 0

      const blockHeight = await syncChecker.getSyncFromAltruist(
        blockchains['0021'].syncCheckOptions,
        blockchains['0021']?.altruist
      )

      expect(blockHeight).to.be.equal(expectedBlockHeight)
    })
  })

  it('Retrieve the sync logs of a all the nodes in a pocket session', async () => {
    const nodes = DEFAULT_NODES

    const relayer = pocketMock.object()
    const session = await relayer.getNewSession(undefined)

    const nodeLogs = await syncChecker.getNodeSyncLogs(
      nodes,
      '1234',
      blockchains['0021'].syncCheckOptions,
      blockchains['0021'].hash,
      '',
      '',
      relayer,
      undefined,
      session
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

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const redisGetSpy = sinon.spy(redis, 'get')
      const redisSetSpy = sinon.spy(redis, 'set')

      let syncedNodes = (
        await syncChecker.consensusFilter({
          nodes,
          requestID: '1234',
          blockchainID: blockchains['0021'].hash,
          syncCheckOptions: blockchains['0021'].syncCheckOptions,
          relayer,
          applicationID: '',
          applicationPublicKey: '',
          blockchainSyncBackup: blockchains['0021']?.altruist,
          pocketAAT: undefined,
          session,
        })
      ).nodes

      expect(syncedNodes).to.have.length(5)

      expect(redisGetSpy.callCount).to.be.equal(2)
      expect(redisSetSpy.callCount).to.be.equal(7)

      // Subsequent calls should retrieve results from redis instead
      syncedNodes = (
        await syncChecker.consensusFilter({
          nodes,
          requestID: '1234',
          blockchainID: blockchains['0021'].hash,
          syncCheckOptions: blockchains['0021'].syncCheckOptions,
          relayer,
          applicationID: '',
          applicationPublicKey: '',
          blockchainSyncBackup: blockchains['0021']?.altruist,
          pocketAAT: undefined,
          session,
        })
      ).nodes

      expect(redisGetSpy.callCount).to.be.equal(3)
      expect(redisSetSpy.callCount).to.be.equal(7)
    })

    it('performs a non-EVM (Solana) sync check successfully', async () => {
      const nodes = DEFAULT_NODES

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const redisGetSpy = sinon.spy(redis, 'get')
      const redisSetSpy = sinon.spy(redis, 'set')

      let syncedNodes = (
        await syncChecker.consensusFilter({
          nodes,
          requestID: '1234',
          blockchainID: blockchains['0006'].hash,
          syncCheckOptions: blockchains['0006'].syncCheckOptions,
          relayer,
          applicationID: '',
          applicationPublicKey: '',
          blockchainSyncBackup: blockchains['0006']?.altruist,
          pocketAAT: undefined,
          session,
        })
      ).nodes

      expect(syncedNodes).to.have.length(5)

      expect(redisGetSpy.callCount).to.be.equal(2)
      expect(redisSetSpy.callCount).to.be.equal(7)

      // Subsequent calls should retrieve results from redis instead
      syncedNodes = (
        await syncChecker.consensusFilter({
          nodes,
          requestID: '1234',
          blockchainID: blockchains['0006'].hash,
          syncCheckOptions: blockchains['0006'].syncCheckOptions,
          relayer,
          applicationID: '',
          applicationPublicKey: '',
          blockchainSyncBackup: blockchains['0006']?.altruist,
          pocketAAT: undefined,
          session,
        })
      ).nodes

      expect(redisGetSpy.callCount).to.be.equal(3)
      expect(redisSetSpy.callCount).to.be.equal(7)
    })

    it('performs a non-EVM (Pocket) sync check successfully', async () => {
      const nodes = DEFAULT_NODES

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const redisGetSpy = sinon.spy(redis, 'get')
      const redisSetSpy = sinon.spy(redis, 'set')

      let syncedNodes = (
        await syncChecker.consensusFilter({
          nodes,
          requestID: '1234',
          blockchainID: blockchains['0001'].hash,
          syncCheckOptions: blockchains['0001'].syncCheckOptions,
          relayer,
          applicationID: '',
          applicationPublicKey: '',
          blockchainSyncBackup: blockchains['0001']?.altruist,
          pocketAAT: undefined,
          session,
        })
      ).nodes

      expect(syncedNodes).to.have.length(5)

      expect(redisGetSpy.callCount).to.be.equal(2)
      expect(redisSetSpy.callCount).to.be.equal(7)

      // Subsequent calls should retrieve results from redis instead
      syncedNodes = (
        await syncChecker.consensusFilter({
          nodes,
          requestID: '1234',
          blockchainID: blockchains['0001'].hash,
          syncCheckOptions: blockchains['0001'].syncCheckOptions,
          relayer,
          applicationID: '',
          applicationPublicKey: '',
          blockchainSyncBackup: blockchains['0001']?.altruist,
          pocketAAT: undefined,
          session,
        })
      ).nodes

      expect(redisGetSpy.callCount).to.be.equal(3)
      expect(redisSetSpy.callCount).to.be.equal(7)
    })

    it('fails a sync check due to wrong result key (evm/non-evm)', async () => {
      const nodes = DEFAULT_NODES

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      blockchains['0006'].syncCheckOptions.resultKey = 'height' // should be 'result'

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0006'].hash,
        syncCheckOptions: blockchains['0006'].syncCheckOptions,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: blockchains['0006']?.altruist,
        pocketAAT: undefined,
        session,
      })

      expect(syncedNodes).to.have.length(5)

      const expectedLog = logSpy.calledWith(
        'error',
        sinon.match((arg: string) => arg.startsWith('SYNC CHECK ERROR'))
      )

      expect(expectedLog).to.be.true()
    })

    it('fails sync check due to altruist and chain error', async () => {
      axiosMock.onPost(blockchains['0021']?.altruist).networkError()

      const nodes = DEFAULT_NODES

      pocketMock.fail = true

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0021'].hash,
        syncCheckOptions: blockchains['0021'].syncCheckOptions,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: blockchains['0021']?.altruist,
        pocketAAT: undefined,
        session,
      })

      expect(syncedNodes).to.have.length(5)

      const expectedLog = logSpy.calledWith(
        'info',
        sinon.match((arg: string) => arg.startsWith('SYNC CHECK ALTRUIST FAILURE'))
      )

      expect(expectedLog).to.be.true()
    })

    it('passes sync check with altruist behind and >80% nodes ahead', async () => {
      const nodes = DEFAULT_NODES

      axiosMock.onPost(blockchains['0021']?.altruist).reply(200, '{ "id": 1, "jsonrpc": "2.0", "result": "0x64" }')

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0021'].hash,
        syncCheckOptions: blockchains['0021'].syncCheckOptions,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: blockchains['0021']?.altruist,
        pocketAAT: undefined,
        session,
      })

      expect(syncedNodes).to.have.length(5)

      const expectedLog = logSpy.calledWith(
        'info',
        sinon.match((arg: string) => arg.endsWith('nodes are ahead of altruist'))
      )

      expect(expectedLog).to.be.true()
    })

    it('fails the sync check due to all nodes failing', async () => {
      const nodes = DEFAULT_NODES

      pocketMock.fail = true

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0021'].hash,
        syncCheckOptions: blockchains['0021'].syncCheckOptions,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: blockchains['0021']?.altruist,
        pocketAAT: undefined,
        session,
      })

      expect(syncedNodes).to.have.length(0)
    })

    it('fails session sync check, all nodes behind altruist', async () => {
      axiosMock.onPost(blockchains['0021']?.altruist).reply(200, '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0d00" }') // 100 blocks after the EVM_RELAY_RESPONSE

      const nodes = DEFAULT_NODES

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0021'].hash,
        syncCheckOptions: blockchains['0021'].syncCheckOptions,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: blockchains['0021']?.altruist,
        pocketAAT: undefined,
        session,
      })

      expect(syncedNodes).to.have.length(0)
    })

    it('pass session sync check, nodes ahead within allowance', async () => {
      const nodes = DEFAULT_NODES

      const altruistHeightResult = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a00c3" }' // 17432771

      axiosMock.onPost(blockchains['0021']?.altruist).reply(200, altruistHeightResult)

      // Nodes ahead within allowance
      const firstNodeAhead = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a00c6" }' // 17432774
      const secondNodeAhead = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a00c7" }' // 17435775

      pocketMock.relayResponse[blockchains['0021'].syncCheckOptions.body] = [
        firstNodeAhead,
        secondNodeAhead,
        altruistHeightResult,
        altruistHeightResult,
        altruistHeightResult,
      ]

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0021'].hash,
        syncCheckOptions: blockchains['0021'].syncCheckOptions,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: blockchains['0021']?.altruist,
        pocketAAT: undefined,
        session,
      })

      expect(syncedNodes).to.have.length(5)
    })

    // TODO: Enable when challenge is implemented
    // it('penalize node failing sync check', async () => {
    //   const nodes = DEFAULT_NODES

    //   const penalizedNode = '{ "id": 1, "jsonrpc": "2.0", "result": "0x1aa38c" }'

    //   pocketMock.relayResponse[blockchains['0021'].syncCheckOptions.body] = [
    //     EVM_RELAY_RESPONSE,
    //     EVM_RELAY_RESPONSE,
    //     EVM_RELAY_RESPONSE,
    //     EVM_RELAY_RESPONSE,
    //     penalizedNode,
    //   ]

    //   const relayer = pocketMock.object()
    //   const session = await relayer.getNewSession(undefined)

    //   const { nodes: syncedNodes } = await syncChecker.consensusFilter({
    //     nodes,
    //     requestID: '1234',
    //     blockchainID: blockchains['0021'].hash,
    //     syncCheckOptions: blockchains['0021'].syncCheckOptions,
    //     relayer,
    //     applicationID: '',
    //     applicationPublicKey: '',
    //     blockchainSyncBackup: blockchains['0021']?.altruist,
    //     pocketAAT: undefined,
    //     session,
    //   })

    //   expect(syncedNodes).to.have.length(4)

    //   const expectedLog = logSpy.calledWith(
    //     'info',
    //     sinon.match((arg: string) => arg.startsWith('SYNC CHECK CHALLENGE'))
    //   )

    //   expect(expectedLog).to.be.true()
    // })

    it('pass session sync check excluding nodes that are too ahead of altruist', async () => {
      const nodes = DEFAULT_NODES

      const altruistHeightResult = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0c7b" }' // 17435771

      axiosMock.onPost(blockchains['0021']?.altruist).reply(200, altruistHeightResult)

      const firstNodeAhead = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0cdf" }' // 17435871
      const secondNodeAhead = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0ce0" }' // 17435872

      pocketMock.relayResponse[blockchains['0021'].syncCheckOptions.body] = [
        firstNodeAhead,
        secondNodeAhead,
        altruistHeightResult,
        altruistHeightResult,
        altruistHeightResult,
      ]

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0021'].hash,
        syncCheckOptions: blockchains['0021'].syncCheckOptions,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: blockchains['0021']?.altruist,
        pocketAAT: undefined,
        session,
      })

      expect(syncedNodes).to.have.length(3)
    })

    it('fails agreement of three highest nodes', async () => {
      const nodes = DEFAULT_NODES

      const highestNode = EVM_RELAY_RESPONSE // 17435804

      // Difference is over the allowed sync check
      const secondHighestNode = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0c7e" }' // 17435774
      const thirdHighestNode = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0c1a" }' // 17435674

      pocketMock.relayResponse[blockchains['0021'].syncCheckOptions.body] = [
        highestNode,
        secondHighestNode,
        thirdHighestNode,
        thirdHighestNode,
        thirdHighestNode,
      ]

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0021'].hash,
        syncCheckOptions: blockchains['0021'].syncCheckOptions,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: blockchains['0021']?.altruist,
        pocketAAT: undefined,
        session,
      })

      expect(syncedNodes).to.have.length(1)

      const expectedLog = logSpy.calledWith('error', 'SYNC CHECK ERROR: three highest nodes could not agree on sync')

      expect(expectedLog).to.be.true()
    })

    it('Fails the sync check due to max relays error on a node', async () => {
      const nodes = DEFAULT_NODES

      pocketMock.relayResponse[blockchains['0021'].syncCheckOptions.body] = [
        EVM_RELAY_RESPONSE,
        EVM_RELAY_RESPONSE,
        EVM_RELAY_RESPONSE,
        EVM_RELAY_RESPONSE,
        new EvidenceSealedError(0, 'error'),
      ]
      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const { nodes: syncedNodes } = await syncChecker.consensusFilter({
        nodes,
        requestID: '1234',
        blockchainID: blockchains['0021'].hash,
        syncCheckOptions: blockchains['0021'].syncCheckOptions,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        blockchainSyncBackup: blockchains['0021']?.altruist,
        pocketAAT: undefined,
        session,
      })

      expect(syncedNodes).to.have.length(4)

      const removedNode = await redis.smembers(`session-key-${session.key}`)

      expect(removedNode).to.have.length(1)
    })
  })
})
