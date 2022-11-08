import { EvidenceSealedError } from '@pokt-foundation/pocketjs-relayer'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { expect, sinon } from '@loopback/testlab'
import { Cache } from '../../src/services/cache'
import { ChainChecker } from '../../src/services/chain-checker'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { metricsRecorderMock } from '../mocks/metrics-recorder'
import { DEFAULT_MOCK_VALUES, DEFAULT_NODES, PocketMock } from '../mocks/pocketjs'
const Redis = require('ioredis-mock')

const logger = require('../../src/services/logger')

const CHAINCHECK_PAYLOAD = '{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'

const DEFAULT_CHAINCHECK_RESPONSE = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'

const { POCKET_AAT } = DEFAULT_MOCK_VALUES

describe('Chain checker service (unit)', () => {
  let chainChecker: ChainChecker
  let metricsRecorder: MetricsRecorder
  let cache: Cache
  let cherryPicker: CherryPicker
  let pocketMock: PocketMock
  let logSpy: sinon.SinonSpy
  let axiosMock: MockAdapter

  const origin = 'unit-test'
  const region = 'us-east-1'

  before('initialize variables', async () => {
    cache = new Cache(new Redis(0, ''), new Redis(1, ''))
    cherryPicker = new CherryPicker({ redis: cache.remote, checkDebug: false })
    metricsRecorder = metricsRecorderMock(cache.remote, cherryPicker)
    chainChecker = new ChainChecker(cache, metricsRecorder, origin, region)

    axiosMock = new MockAdapter(axios)
    axiosMock.onPost('https://user:pass@backups.example.org:18081/v1/query/node').reply(200, {
      service_url: 'https://localhost:443',
    })
  })

  beforeEach(async () => {
    logSpy = sinon.spy(logger, 'log')

    pocketMock = new PocketMock()
    pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = DEFAULT_CHAINCHECK_RESPONSE

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
    expect(chainChecker).to.be.ok()
  })

  describe('getNodeChainLog function', () => {
    it('Retrieve the logs of a node', async () => {
      const node = DEFAULT_NODES[0]

      pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const nodeLog = await chainChecker.getNodeChainLog({
        node,
        requestID: '1234',
        blockchainID: '0027',
        chainCheck: CHAINCHECK_PAYLOAD,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: POCKET_AAT,
        session,
      })

      const expectedChainID = 100 // 0x64 to base 10

      expect(nodeLog.node).to.be.equal(node)
      expect(nodeLog.chainID).to.be.equal(expectedChainID)
    })

    it('Fails gracefully on handled error result', async () => {
      const node = DEFAULT_NODES[0]

      pocketMock.fail = true

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const nodeLog = await chainChecker.getNodeChainLog({
        node,
        requestID: '1234',
        blockchainID: '0027',
        chainCheck: CHAINCHECK_PAYLOAD,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: POCKET_AAT,
        session,
      })

      const expectedChainID = 0

      expect(nodeLog.node).to.be.equal(node)
      expect(nodeLog.chainID).to.be.equal(expectedChainID)
    })

    it('Fails gracefully on unhandled error result', async () => {
      const node = DEFAULT_NODES[0]

      // Invalid JSON string
      pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = 'id":1,"jsonrp:"2.0","result": "0x64"}'

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const nodeLog = await chainChecker.getNodeChainLog({
        node,
        requestID: '1234',
        blockchainID: '0027',
        chainCheck: CHAINCHECK_PAYLOAD,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: POCKET_AAT,
        session,
      })

      const expectedChainID = 0

      expect(nodeLog.node).to.be.equal(node)
      expect(nodeLog.chainID).to.be.equal(expectedChainID)

      const expectedLog = logSpy.calledWith(
        'error',
        sinon.match((arg: string) => arg.startsWith('CHAIN CHECK ERROR UNHANDLED'))
      )

      expect(expectedLog).to.be.true()
    })
  })

  it('Retrieve the logs of all the nodes in a pocket session', async () => {
    const nodes = DEFAULT_NODES

    const relayer = pocketMock.object()
    const session = await relayer.getNewSession(undefined)

    const nodeLogs = await chainChecker.getNodeChainLogs({
      nodes,
      requestID: '1234',
      blockchainID: '0027',
      chainCheck: CHAINCHECK_PAYLOAD,
      relayer,
      applicationID: '',
      applicationPublicKey: '',
      pocketAAT: POCKET_AAT,
      session,
    })

    const expectedChainID = 100 // 0x64 to base 10

    nodeLogs.forEach((nodeLog, idx: number) => {
      expect(nodeLog.node).to.be.deepEqual(nodes[idx])
      expect(nodeLog.chainID).to.be.equal(expectedChainID)
    })
  })

  it('performs the chain check successfully', async () => {
    const nodes = DEFAULT_NODES

    const relayer = pocketMock.object()
    const session = await relayer.getNewSession(undefined)

    const chainID = 100
    const cacheGetSpy = sinon.spy(cache, 'get')
    const cacheSetSpy = sinon.spy(cache, 'set')

    let checkedNodes = (
      await chainChecker.chainIDFilter({
        nodes,
        requestID: '1234',
        blockchainID: '0027',
        chainCheck: CHAINCHECK_PAYLOAD,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: POCKET_AAT,
        session,
        chainID,
      })
    ).nodes

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(5)

    expect(cacheGetSpy.callCount).to.be.equal(2)
    expect(cacheSetSpy.callCount).to.be.equal(2)

    // Subsequent calls should retrieve results from cache instead
    checkedNodes = (
      await chainChecker.chainIDFilter({
        nodes,
        requestID: '1234',
        blockchainID: '0027',
        chainCheck: CHAINCHECK_PAYLOAD,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: POCKET_AAT,
        session,
        chainID,
      })
    ).nodes

    expect(cacheGetSpy.callCount).to.be.equal(3)
    expect(cacheSetSpy.callCount).to.be.equal(2)
  })

  it('fails the chain check', async () => {
    const nodes = DEFAULT_NODES

    // Default nodes are set with a chainID of 100
    pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = '{"id":1,"jsonrpc":"2.0","result":"0xC8"}' // 0xC8 to base 10: 200
    const relayer = pocketMock.object()
    const session = await relayer.getNewSession(undefined)

    const chainID = 100
    const { nodes: checkedNodes } = await chainChecker.chainIDFilter({
      nodes,
      requestID: '1234',
      blockchainID: '0027',
      chainCheck: CHAINCHECK_PAYLOAD,
      relayer,
      applicationID: '',
      applicationPublicKey: '',
      pocketAAT: POCKET_AAT,
      session,
      chainID,
    })

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(0)
  })

  it('Fails the chain check due to max relays error on a node', async () => {
    const nodes = DEFAULT_NODES
    const blockchainID = '0027'
    const chainID = 100

    // Fails last node due to max relays
    pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = [
      DEFAULT_CHAINCHECK_RESPONSE,
      DEFAULT_CHAINCHECK_RESPONSE,
      DEFAULT_CHAINCHECK_RESPONSE,
      DEFAULT_CHAINCHECK_RESPONSE,
      new EvidenceSealedError(0, 'error'),
    ]

    const relayer = pocketMock.object()
    const session = await relayer.getNewSession(undefined)

    const { nodes: checkedNodes } = await chainChecker.chainIDFilter({
      nodes,
      requestID: '1234',
      blockchainID: blockchainID,
      chainCheck: CHAINCHECK_PAYLOAD,
      relayer,
      applicationID: '',
      applicationPublicKey: '',
      pocketAAT: POCKET_AAT,
      chainID,
      session,
    })

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(4)

    const removedNode = await cache.smembers(`session-key-${session.key}`)

    expect(removedNode).to.have.length(1)
  })
})
