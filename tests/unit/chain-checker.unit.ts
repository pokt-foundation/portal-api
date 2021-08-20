import RedisMock from 'ioredis-mock'
import { expect, sinon } from '@loopback/testlab'
import { Configuration } from '@pokt-network/pocket-js'

import { getPocketConfigOrDefault } from '../../src/config/pocket-config'
import { ChainChecker } from '../../src/services/chain-checker'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { metricsRecorderMock } from '../mocks/metricsRecorder'
import { DEFAULT_NODES, PocketMock } from '../mocks/pocketjs'

const logger = require('../../src/services/logger')

const CHAINCHECK_PAYLOAD = '{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'

describe('Chain checker service (unit)', () => {
  let chainChecker: ChainChecker
  let metricsRecorder: MetricsRecorder
  let redis: RedisMock
  let cherryPicker: CherryPicker
  let pocketConfiguration: Configuration
  let pocketMock: PocketMock
  let logSpy: sinon.SinonSpy

  before('initialize variables', async () => {
    redis = new RedisMock(0, '')
    cherryPicker = new CherryPicker({ redis, checkDebug: false })
    metricsRecorder = metricsRecorderMock(redis, cherryPicker)
    chainChecker = new ChainChecker(redis, metricsRecorder)
    pocketConfiguration = getPocketConfigOrDefault()
  })

  beforeEach(async () => {
    logSpy = sinon.spy(logger, 'log')

    pocketMock = new PocketMock()
    pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'

    await redis.flushall()
  })

  afterEach(() => {
    sinon.restore()
  })

  it('should be defined', async () => {
    expect(chainChecker).to.be.ok()
  })

  it('updates the configuration consensus to one already set', () => {
    const configuration = getPocketConfigOrDefault({ consensusNodeCount: 9 })
    const expectedConsensusCount = 5
    const newConfig = chainChecker.updateConfigurationConsensus(configuration)

    expect(newConfig.consensusNodeCount).to.be.equal(expectedConsensusCount)
  })

  it('updates the configuration request timeout to one already set', () => {
    const configuration = getPocketConfigOrDefault({
      requestTimeout: 10000,
    })
    const expectedTimeout = 4000
    const newConfig = chainChecker.updateConfigurationTimeout(configuration)

    expect(newConfig.requestTimeOut).to.be.equal(expectedTimeout)
  })

  describe('getNodeChainLog function', () => {
    it('Retrieve the logs of a node', async () => {
      const node = DEFAULT_NODES[0]

      pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'

      const pocketClient = pocketMock.object()
      const nodeLog = await chainChecker.getNodeChainLog({
        node,
        requestID: '1234',
        blockchain: '100',
        chainCheck: CHAINCHECK_PAYLOAD,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: undefined,
        pocketConfiguration,
      })

      const expectedChainID = 100 // 0x64 to base 10

      expect(nodeLog.node).to.be.equal(node)
      expect(nodeLog.chainID).to.be.equal(expectedChainID)
    })

    it('Fails gracefully on handled error result', async () => {
      const node = DEFAULT_NODES[0]

      pocketMock.fail = true

      const pocketClient = pocketMock.object()
      const nodeLog = await chainChecker.getNodeChainLog({
        node,
        requestID: '1234',
        blockchain: '100',
        chainCheck: CHAINCHECK_PAYLOAD,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: undefined,
        pocketConfiguration,
      })

      const expectedChainID = 0

      expect(nodeLog.node).to.be.equal(node)
      expect(nodeLog.chainID).to.be.equal(expectedChainID)
    })

    it('Fails gracefully on unhandled error result', async () => {
      const node = DEFAULT_NODES[0]

      // Invalid JSON string
      pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = 'id":1,"jsonrp:"2.0","result": "0x64"}'

      const pocketClient = pocketMock.object()
      const nodeLog = await chainChecker.getNodeChainLog({
        node,
        requestID: '1234',
        blockchain: '100',
        chainCheck: CHAINCHECK_PAYLOAD,
        pocket: pocketClient,
        applicationID: '',
        applicationPublicKey: '',
        pocketAAT: undefined,
        pocketConfiguration,
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

  it('Retrieve the logs of a all the nodes in a pocket session', async () => {
    const nodes = DEFAULT_NODES

    const pocketClient = pocketMock.object()
    const nodeLogs = await chainChecker.getNodeChainLogs({
      nodes,
      requestID: '1234',
      blockchain: '100',
      chainCheck: CHAINCHECK_PAYLOAD,
      pocket: pocketClient,
      applicationID: '',
      applicationPublicKey: '',
      pocketAAT: undefined,
      pocketConfiguration,
    })

    const expectedChainID = 100 // 0x64 to base 10

    nodeLogs.forEach((nodeLog, idx: number) => {
      expect(nodeLog.node).to.be.deepEqual(nodes[idx])
      expect(nodeLog.chainID).to.be.equal(expectedChainID)
    })
  })

  it('performs the chain check successfully', async () => {
    const nodes = DEFAULT_NODES

    const pocketClient = pocketMock.object()
    const chainID = 100
    const redisGetSpy = sinon.spy(redis, 'get')
    const redisSetSpy = sinon.spy(redis, 'set')

    let checkedNodes = await chainChecker.chainIDFilter({
      nodes,
      requestID: '1234',
      blockchain: '100',
      chainCheck: CHAINCHECK_PAYLOAD,
      pocket: pocketClient,
      applicationID: '',
      applicationPublicKey: '',
      pocketAAT: undefined,
      pocketConfiguration,
      chainID,
    })

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(5)

    expect(redisGetSpy.callCount).to.be.equal(2)
    expect(redisSetSpy.callCount).to.be.equal(2)

    // Subsequent calls should retrieve results from redis instead
    checkedNodes = await chainChecker.chainIDFilter({
      nodes,
      requestID: '1234',
      blockchain: '100',
      chainCheck: CHAINCHECK_PAYLOAD,
      pocket: pocketClient,
      applicationID: '',
      applicationPublicKey: '',
      pocketAAT: undefined,
      pocketConfiguration,
      chainID,
    })

    expect(redisGetSpy.callCount).to.be.equal(3)
    expect(redisSetSpy.callCount).to.be.equal(2)
  })

  it('fails the chain check', async () => {
    const nodes = DEFAULT_NODES

    // Default nodes are set with a chainID of 100
    pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = '{"id":1,"jsonrpc":"2.0","result":"0xC8"}' // 0xC8 to base 10: 200

    const pocketClient = pocketMock.object()
    const chainID = 100
    const checkedNodes = await chainChecker.chainIDFilter({
      nodes,
      requestID: '1234',
      blockchain: chainID.toString(),
      chainCheck: CHAINCHECK_PAYLOAD,
      pocket: pocketClient,
      applicationID: '',
      applicationPublicKey: '',
      pocketAAT: undefined,
      pocketConfiguration,
      chainID,
    })

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(0)
  })
})
