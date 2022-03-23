import { EvidenceSealedError } from '@pokt-foundation/pocketjs-relayer'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import RedisMock from 'ioredis-mock'
import { expect, sinon } from '@loopback/testlab'

import { ChainChecker } from '../../src/services/chain-checker'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { metricsRecorderMock } from '../mocks/metrics-recorder'
import { DEFAULT_NODES, PocketMock } from '../mocks/pocketjs'

const logger = require('../../src/services/logger')

const CHAINCHECK_PAYLOAD = '{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'

const DEFAULT_CHAINCHECK_RESPONSE = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'

describe('Chain checker service (unit)', () => {
  let chainChecker: ChainChecker
  let metricsRecorder: MetricsRecorder
  let redis: RedisMock
  let cherryPicker: CherryPicker
  let pocketMock: PocketMock
  let logSpy: sinon.SinonSpy
  let axiosMock: MockAdapter

  const origin = 'unit-test'

  before('initialize variables', async () => {
    redis = new RedisMock(0, '')
    cherryPicker = new CherryPicker({ redis, checkDebug: false })
    metricsRecorder = metricsRecorderMock(redis, cherryPicker)
    chainChecker = new ChainChecker(redis, metricsRecorder, origin)

    axiosMock = new MockAdapter(axios)
    axiosMock.onPost('https://user:pass@backups.example.org:18081/v1/query/node').reply(200, {
      service_url: 'https://localhost:443',
    })
  })

  beforeEach(async () => {
    logSpy = sinon.spy(logger, 'log')

    pocketMock = new PocketMock()
    pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = DEFAULT_CHAINCHECK_RESPONSE

    await redis.flushall()
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
        pocketAAT: undefined,
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
        pocketAAT: undefined,
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
        pocketAAT: undefined,
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
      pocketAAT: undefined,
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
    const redisGetSpy = sinon.spy(redis, 'get')
    const redisSetSpy = sinon.spy(redis, 'set')

    let checkedNodes = (
      await chainChecker.chainIDFilter({
        nodes,
        requestID: '1234',
        blockchainID: '0027',
        chainCheck: CHAINCHECK_PAYLOAD,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: undefined,
        session,
        chainID,
      })
    ).nodes

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(5)

    expect(redisGetSpy.callCount).to.be.equal(2)
    expect(redisSetSpy.callCount).to.be.equal(2)

    // Subsequent calls should retrieve results from redis instead
    checkedNodes = (
      await chainChecker.chainIDFilter({
        nodes,
        requestID: '1234',
        blockchainID: '0027',
        chainCheck: CHAINCHECK_PAYLOAD,
        relayer,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: undefined,
        session,
        chainID,
      })
    ).nodes

    expect(redisGetSpy.callCount).to.be.equal(3)
    expect(redisSetSpy.callCount).to.be.equal(2)
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
      pocketAAT: undefined,
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
      pocketAAT: undefined,
      chainID,
      session,
    })

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(4)

    const removedNode = await redis.smembers(`session-key-${session.key}`)

    expect(removedNode).to.have.length(1)
  })
})
