import { EvidenceSealedError } from '@pokt-foundation/pocketjs-relayer'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { expect, sinon } from '@loopback/testlab'
import { ArchivalChecker } from '../../src/services/archival-checker'
import { Cache } from '../../src/services/cache'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { metricsRecorderMock } from '../mocks/metrics-recorder'
import { DEFAULT_MOCK_VALUES, DEFAULT_NODES, PocketMock } from '../mocks/pocketjs'
const Redis = require('ioredis-mock')

const logger = require('../../src/services/logger')

const ARCHIVAL_CHECK_PAYLOAD = JSON.stringify({
  method: 'eth_getBalance',
  params: ['0xe5Fb31A5CaEE6a96de393bdBF89FBe65fe125Bb3', '0x1'],
  id: 1,
  jsonrpc: '2.0',
})

const FAILED_ARCHIVAL_CHECK_RESPONSE = JSON.stringify({
  error: {
    code: -32000,
    message: 'missing trie node d67e4d450343046425ae4271474353857ab860dbc0a1dde64b41b5cd3a532bf3 (path ) <nil>',
  },
  id: 1,
  jsonrpc: '2.0',
})

const SUCCESS_ARCHIVAL_CHECK_RESPONSE = JSON.stringify({
  id: 1,
  jsonrpc: '2.0',
  result: '0x3635c9adc5dea00000',
})

const { POCKET_AAT } = DEFAULT_MOCK_VALUES

describe('Archival checker service (unit)', () => {
  let archivalChecker: ArchivalChecker
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
    archivalChecker = new ArchivalChecker(cache, metricsRecorder, origin)

    axiosMock = new MockAdapter(axios)
    axiosMock.onPost('https://user:pass@backups.example.org:18081/v1/query/node').reply(200, {
      service_url: 'https://localhost:443',
    })
  })

  beforeEach(async () => {
    logSpy = sinon.spy(logger, 'log')

    pocketMock = new PocketMock()
    pocketMock.relayResponse[ARCHIVAL_CHECK_PAYLOAD] = SUCCESS_ARCHIVAL_CHECK_RESPONSE

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
    expect(archivalChecker).to.be.ok()
  })

  describe('getNodeChainLog function', () => {
    it('Retrieve the logs of a node', async () => {
      const node = DEFAULT_NODES[0]

      pocketMock.relayResponse[ARCHIVAL_CHECK_PAYLOAD] = FAILED_ARCHIVAL_CHECK_RESPONSE

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const nodeLog = await archivalChecker.getNodeArchivalLog({
        node,
        requestID: '1234',
        blockchainID: '0027',
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: POCKET_AAT,
        session,
        dynamicAddress: false,
      })

      const expectedErrorStart = 'missing trie node'

      expect(nodeLog.node).to.be.equal(node)
      expect(nodeLog.error).startWith(expectedErrorStart)
    })

    it('Fails gracefully on handled error result', async () => {
      const node = DEFAULT_NODES[0]

      pocketMock.fail = true

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const nodeLog = await archivalChecker.getNodeArchivalLog({
        node,
        requestID: '1234',
        blockchainID: '0027',
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: POCKET_AAT,
        session,
        dynamicAddress: false,
      })

      const expectedError = 'missing trie node'

      expect(nodeLog.node).to.be.equal(node)
      expect(nodeLog.error).to.be.equal(expectedError)
    })

    it('Fails gracefully on unhandled error result', async () => {
      const node = DEFAULT_NODES[0]

      // Invalid JSON string
      pocketMock.relayResponse[ARCHIVAL_CHECK_PAYLOAD] = 'id":1,"jsonrp:"2.0","result": "0x64"}'

      const relayer = pocketMock.object()
      const session = await relayer.getNewSession(undefined)

      const nodeLog = await archivalChecker.getNodeArchivalLog({
        node,
        requestID: '1234',
        blockchainID: '0027',
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: POCKET_AAT,
        session,
        dynamicAddress: false,
      })

      const expectedError = 'missing trie node'

      expect(nodeLog.node).to.be.equal(node)
      expect(nodeLog.error).to.be.equal(expectedError)

      const expectedLog = logSpy.calledWith(
        'error',
        sinon.match((arg: string) => arg.startsWith('ARCHIVAL CHECK ERROR UNHANDLED'))
      )

      expect(expectedLog).to.be.true()
    })
  })

  it('Retrieve the logs of all the nodes in a pocket session', async () => {
    const nodes = DEFAULT_NODES

    const relayer = pocketMock.object()
    const session = await relayer.getNewSession(undefined)

    const nodeLogs = await archivalChecker.getNodeArchivalLogs({
      nodes,
      requestID: '1234',
      blockchainID: '0027',
      relayer,
      applicationID: '',
      applicationPublicKey: '',
      pocketAAT: POCKET_AAT,
      session,
      dynamicAddress: false,
    })

    const expectedError = '' // Success archival checks

    nodeLogs.forEach((nodeLog, idx: number) => {
      expect(nodeLog.node).to.be.deepEqual(nodes[idx])
      expect(nodeLog.error).to.be.equal(expectedError)
    })
  })

  it('performs the archival check successfully', async () => {
    const nodes = DEFAULT_NODES

    const relayer = pocketMock.object()
    const session = await relayer.getNewSession(undefined)

    const cacheGetSpy = sinon.spy(cache, 'get')
    const cacheSetSpy = sinon.spy(cache, 'set')

    let checkedNodes = (
      await archivalChecker.archivalModeFilter({
        nodes,
        requestID: '1234',
        blockchainID: '0027',
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: POCKET_AAT,
        session,
        dynamicAddress: false,
      })
    ).nodes

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(5)

    expect(cacheGetSpy.callCount).to.be.equal(2)
    expect(cacheSetSpy.callCount).to.be.equal(2)

    // Subsequent calls should retrieve results from cache instead
    checkedNodes = (
      await archivalChecker.archivalModeFilter({
        nodes,
        requestID: '1234',
        blockchainID: '0027',
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: POCKET_AAT,
        session,
        dynamicAddress: false,
      })
    ).nodes

    expect(cacheGetSpy.callCount).to.be.equal(3)
    expect(cacheSetSpy.callCount).to.be.equal(2)
  })

  it('fails the archival check', async () => {
    const nodes = DEFAULT_NODES

    pocketMock.relayResponse[ARCHIVAL_CHECK_PAYLOAD] = FAILED_ARCHIVAL_CHECK_RESPONSE
    const relayer = pocketMock.object()
    const session = await relayer.getNewSession(undefined)

    const { nodes: checkedNodes } = await archivalChecker.archivalModeFilter({
      nodes,
      requestID: '1234',
      blockchainID: '0027',
      relayer,
      applicationID: '',
      applicationPublicKey: '',
      pocketAAT: POCKET_AAT,
      session,
      dynamicAddress: false,
    })

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(0)
  })

  it('Fails the archival check due to max relays error on a node', async () => {
    const nodes = DEFAULT_NODES
    const blockchainID = '0027'

    // Fails last node due to max relays
    pocketMock.relayResponse[ARCHIVAL_CHECK_PAYLOAD] = [
      SUCCESS_ARCHIVAL_CHECK_RESPONSE,
      SUCCESS_ARCHIVAL_CHECK_RESPONSE,
      SUCCESS_ARCHIVAL_CHECK_RESPONSE,
      SUCCESS_ARCHIVAL_CHECK_RESPONSE,
      new EvidenceSealedError(0, 'error'),
    ]

    const relayer = pocketMock.object()
    const session = await relayer.getNewSession(undefined)

    const { nodes: checkedNodes } = await archivalChecker.archivalModeFilter({
      nodes,
      requestID: '1234',
      blockchainID: blockchainID,
      relayer,
      applicationID: '',
      applicationPublicKey: '',
      pocketAAT: POCKET_AAT,
      session,
      dynamicAddress: false,
    })

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(4)

    const removedNode = await cache.smembers(`session-key-${session.key}`)

    expect(removedNode).to.have.length(1)
  })
})
