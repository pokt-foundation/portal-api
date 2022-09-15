/* eslint-disable mocha/no-exclusive-tests */
import { EvidenceSealedError } from '@pokt-foundation/pocketjs-relayer'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { expect, sinon } from '@loopback/testlab'
import { Cache } from '../../src/services/cache'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MergeChecker } from '../../src/services/merge-checker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { metricsRecorderMock } from '../mocks/metrics-recorder'
import { DEFAULT_MOCK_VALUES, DEFAULT_NODES, PocketMock } from '../mocks/pocketjs'
const Redis = require('ioredis-mock')

const logger = require('../../src/services/logger')

const MERGE_CHECK_PAYLOAD = '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["latest",false],"id":1}'

// Success (merged node)
const SUCCESS_MERGE_CHECK_RESPONSE =
  '{"jsonrpc":"2.0","id":1,"result":{"number":"0xEd14c8","totalDifficulty":"0xc70d808a128d7380000"}}'

// Failure (non-merged node)
const FAILURE_MERGE_CHECK_RESPONSE =
  '{"jsonrpc":"2.0","id":1,"result":{"number":"0xed1353","totalDifficulty":"0xc7098c61d0934e949f3"}}'

const { POCKET_AAT } = DEFAULT_MOCK_VALUES

describe('Merge checker service (unit)', () => {
  let mergeChecker: MergeChecker
  let metricsRecorder: MetricsRecorder
  let cache: Cache
  let cherryPicker: CherryPicker
  let pocketMock: PocketMock
  let logSpy: sinon.SinonSpy
  let axiosMock: MockAdapter

  const origin = 'unit-test'

  before('initialize variables', async () => {
    cache = new Cache(new Redis(0, ''), new Redis(1, ''))
    cherryPicker = new CherryPicker({ redis: cache.remote, checkDebug: false })
    metricsRecorder = metricsRecorderMock(cache.remote, cherryPicker)
    mergeChecker = new MergeChecker(cache, metricsRecorder, origin)

    axiosMock = new MockAdapter(axios)
    axiosMock.onPost('https://user:pass@backups.example.org:18081/v1/query/node').reply(200, {
      service_url: 'https://localhost:443',
    })
  })

  beforeEach(async () => {
    logSpy = sinon.spy(logger, 'log')

    pocketMock = new PocketMock()
    pocketMock.relayResponse[MERGE_CHECK_PAYLOAD] = SUCCESS_MERGE_CHECK_RESPONSE

    await cache.flushall()
  })

  afterEach(() => {
    sinon.restore()
  })

  after(() => {
    axiosMock.restore()
    sinon.restore()
  })

  it('should be defined', async () => {
    expect(mergeChecker).to.be.ok()
  })

  describe('getNodeMergeLog function', () => {
    it('Retrieve the logs of a node', async () => {
      const node = DEFAULT_NODES[0]

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const nodeLog = await mergeChecker.getNodeMergeLog({
        node,
        requestID: '1234',
        blockchainID: '0021',
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: POCKET_AAT,
        session,
      })

      const expectedTotalDifficulty = '0xc70d808a128d7380000'
      const expectedBlockNumber = 15537352

      expect(nodeLog.node).to.be.equal(node)
      expect(nodeLog.totalDifficulty).to.be.equal(expectedTotalDifficulty)
      expect(nodeLog.blockNumber).to.be.equal(expectedBlockNumber)
    })

    it('Fails gracefully on handled error result', async () => {
      const node = DEFAULT_NODES[0]

      pocketMock.fail = true

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const nodeLog = await mergeChecker.getNodeMergeLog({
        node,
        requestID: '1234',
        blockchainID: '0021',
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: POCKET_AAT,
        session,
      })

      const expectedTotalDifficulty = '0'
      const expectedBlockNumber = 0

      expect(nodeLog.node).to.be.equal(node)
      expect(nodeLog.totalDifficulty).to.be.equal(expectedTotalDifficulty)
      expect(nodeLog.blockNumber).to.be.equal(expectedBlockNumber)
    })

    it('Fails gracefully on unhandled error result', async () => {
      const node = DEFAULT_NODES[0]

      // Invalid JSON string
      pocketMock.relayResponse[MERGE_CHECK_PAYLOAD] = 'id":1,"jsonrp:"2.0",'

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const nodeLog = await mergeChecker.getNodeMergeLog({
        node,
        requestID: '1234',
        blockchainID: '0021',
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: POCKET_AAT,
        session,
      })

      const expectedTotalDifficulty = '0'
      const expectedBlockNumber = 0

      expect(nodeLog.node).to.be.equal(node)
      expect(nodeLog.totalDifficulty).to.be.equal(expectedTotalDifficulty)
      expect(nodeLog.blockNumber).to.be.equal(expectedBlockNumber)

      const expectedLog = logSpy.calledWith(
        'error',
        sinon.match((arg: string) => arg.startsWith('MERGE CHECK ERROR UNHANDLED'))
      )

      expect(expectedLog).to.be.true()
    })
  })

  it('Retrieve the logs of all the nodes in a pocket session', async () => {
    const nodes = DEFAULT_NODES

    const relayer = pocketMock.object()
    const session = await relayer.getNewSession(undefined)

    const nodeLogs = await mergeChecker.getMergeCheckLogs({
      nodes,
      requestID: '1234',
      blockchainID: '0021',
      relayer,
      applicationID: '',
      applicationPublicKey: '',
      pocketAAT: POCKET_AAT,
      session,
    })

    const expectedTotalDifficulty = '0xc70d808a128d7380000'
    const expectedBlockNumber = 15537352

    nodeLogs.forEach((nodeLog, idx: number) => {
      expect(nodeLog.node).to.be.deepEqual(nodes[idx])
      expect(nodeLog.totalDifficulty).to.be.equal(expectedTotalDifficulty)
      expect(nodeLog.blockNumber).to.be.equal(expectedBlockNumber)
    })
  })

  it('performs the merge check successfully', async () => {
    const nodes = DEFAULT_NODES

    const relayer = pocketMock.object()
    const session = await relayer.getNewSession(undefined)

    const cacheGetSpy = sinon.spy(cache, 'get')
    const cacheSetSpy = sinon.spy(cache, 'set')

    let checkedNodes = (
      await mergeChecker.mergeStatusFilter({
        nodes,
        requestID: '1234',
        blockchainID: '0021',
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: POCKET_AAT,
        session,
      })
    ).nodes

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(5)

    expect(cacheGetSpy.callCount).to.be.equal(2)
    expect(cacheSetSpy.callCount).to.be.equal(2)

    // Subsequent calls should retrieve results from cache instead
    checkedNodes = (
      await mergeChecker.mergeStatusFilter({
        nodes,
        requestID: '1234',
        blockchainID: '0021',
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: POCKET_AAT,
        session,
      })
    ).nodes

    expect(cacheGetSpy.callCount).to.be.equal(3)
    expect(cacheSetSpy.callCount).to.be.equal(2)
  })

  it('fails the merge check', async () => {
    const nodes = DEFAULT_NODES

    // By default, nodes pass the merge check
    pocketMock.relayResponse[MERGE_CHECK_PAYLOAD] = FAILURE_MERGE_CHECK_RESPONSE
    const relayer = pocketMock.object()
    const session = await relayer.getNewSession(undefined)

    const { nodes: checkedNodes } = await mergeChecker.mergeStatusFilter({
      nodes,
      requestID: '1234',
      blockchainID: '0021',
      relayer,
      applicationID: '',
      applicationPublicKey: '',
      pocketAAT: POCKET_AAT,
      session,
    })

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(0)
  })

  it('Fails the chain check due to max relays error on a node', async () => {
    const nodes = DEFAULT_NODES
    const blockchainID = '0021'

    // Fails last node due to max relays
    pocketMock.relayResponse[MERGE_CHECK_PAYLOAD] = [
      SUCCESS_MERGE_CHECK_RESPONSE,
      SUCCESS_MERGE_CHECK_RESPONSE,
      SUCCESS_MERGE_CHECK_RESPONSE,
      SUCCESS_MERGE_CHECK_RESPONSE,
      new EvidenceSealedError(0, 'error'),
    ]

    const relayer = pocketMock.object()
    const session = await relayer.getNewSession(undefined)

    const { nodes: checkedNodes } = await mergeChecker.mergeStatusFilter({
      nodes,
      requestID: '1234',
      blockchainID: blockchainID,
      relayer,
      applicationID: '',
      applicationPublicKey: '',
      pocketAAT: POCKET_AAT,
      session,
    })

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(4)

    const removedNode = await cache.smembers(`session-key-${session.key}`)

    expect(removedNode).to.have.length(1)
  })

  it.only('Fails on two nodes, passes in three', async () => {
    const nodes = DEFAULT_NODES
    const blockchainID = '0021'

    pocketMock.relayResponse[MERGE_CHECK_PAYLOAD] = [
      FAILURE_MERGE_CHECK_RESPONSE,
      FAILURE_MERGE_CHECK_RESPONSE,
      SUCCESS_MERGE_CHECK_RESPONSE,
      SUCCESS_MERGE_CHECK_RESPONSE,
      SUCCESS_MERGE_CHECK_RESPONSE,
    ]

    const relayer = pocketMock.object()
    const session = await relayer.getNewSession(undefined)

    const { nodes: checkedNodes } = await mergeChecker.mergeStatusFilter({
      nodes,
      requestID: '1234',
      blockchainID: blockchainID,
      relayer,
      applicationID: '',
      applicationPublicKey: '',
      pocketAAT: POCKET_AAT,
      session,
    })

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(3)
  })
})
