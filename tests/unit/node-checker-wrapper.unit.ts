import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import RedisMock from 'ioredis-mock'
import { expect, sinon } from '@loopback/testlab'
import { Configuration, Session, RpcError } from '@pokt-network/pocket-js'
import { getPocketConfigOrDefault } from '../../src/config/pocket-config'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { ChainCheck, NodeChecker } from '../../src/services/node-checker'
import { NodeCheckerWrapper } from '../../src/services/node-checker-wrapper'
import { MAX_RELAYS_ERROR } from '../../src/utils/constants'
import { metricsRecorderMock } from '../mocks/metrics-recorder'
import { DEFAULT_NODES, PocketMock } from '../mocks/pocketjs'

const logger = require('../../src/services/logger')

const CHAINCHECK_PAYLOAD = '{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'
const DEFAULT_CHAINCHECK_RESPONSE = '{"id":1,"jsonrpc":"2.0","result":"0x64"}' // 100
const ORIGIN = 'node-checker-wrapper'

describe('Node checker wrapper (unit)', () => {
  let pocketSession: Session
  let redis: RedisMock
  let metricsRecorder: MetricsRecorder
  let cherryPicker: CherryPicker
  let pocketConfiguration: Configuration
  let axiosMock: MockAdapter
  let pocketMock: PocketMock
  let nodeCheckerWrapper: NodeCheckerWrapper
  let logSpy: sinon.SinonSpy
  let nodeChecker: NodeChecker

  before('initialize variables', async () => {
    redis = new RedisMock(0, '')
    cherryPicker = new CherryPicker({ redis, checkDebug: false })
    metricsRecorder = metricsRecorderMock(redis, cherryPicker)
    pocketConfiguration = getPocketConfigOrDefault()
    axiosMock = new MockAdapter(axios)
  })

  beforeEach(async () => {
    logSpy = sinon.spy(logger, 'log')

    axiosMock.onPost('https://user:pass@backups.example.org:18081/v1/query/node').reply(200, {
      service_url: 'https://localhost:443',
    })

    pocketMock = new PocketMock(undefined, undefined, pocketConfiguration)
    pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = DEFAULT_CHAINCHECK_RESPONSE
    const pocket = pocketMock.object()

    pocketSession = (await pocket.sessionManager.getCurrentSession(undefined, undefined, undefined)) as Session

    nodeChecker = new NodeChecker(pocket, pocketConfiguration)

    nodeCheckerWrapper = new NodeCheckerWrapper(pocket, redis, metricsRecorder, ORIGIN)

    await redis.flushall()
  })

  afterEach(() => {
    sinon.restore()
    axiosMock.reset()
  })

  after(() => {
    axiosMock.restore()
  })

  it('should be defined', async () => {
    expect(nodeCheckerWrapper).to.be.ok()
  })

  it('performs blockchain challenge succesffully', async () => {
    await nodeCheckerWrapper['performChallenge'](
      CHAINCHECK_PAYLOAD,
      '0027',
      undefined,
      pocketConfiguration,
      pocketSession,
      '',
      '',
      ''
    )

    // Succesfull challenge will contain the response payload in the response body
    const expectedLog = logSpy.calledWith(
      'info',
      sinon.match((arg: string) => arg.includes('0x64'))
    )

    expect(expectedLog).to.be.true()
  })

  it('caches and retrieves saved nodes accordingly', async () => {
    // Before saving to cache
    const redisGetSpy = sinon.spy(redis, 'get')
    const redisSetSpy = sinon.spy(redis, 'set')
    const cacheKey = 'nodes'

    let cachedNodes = await nodeCheckerWrapper['cacheNodes'](DEFAULT_NODES, cacheKey)

    expect(cachedNodes).to.have.length(0)
    expect(redisGetSpy.callCount).to.be.equal(2)
    expect(redisSetSpy.callCount).to.be.equal(1)

    const cacheLock = await redis.get('lock-' + cacheKey)

    expect(cacheLock).to.be.equal('true')

    // Call with cache lock on (no cache)
    cachedNodes = await nodeCheckerWrapper['cacheNodes'](DEFAULT_NODES, cacheKey)

    expect(cachedNodes).to.have.length(5)
    expect(redisGetSpy.callCount).to.be.equal(5)
    expect(redisSetSpy.callCount).to.be.equal(1)

    // // After saving to cache
    await redis.set('nodes', JSON.stringify(DEFAULT_NODES.slice(1).map((node) => node.publicKey)))
    cachedNodes = await nodeCheckerWrapper['cacheNodes'](DEFAULT_NODES, cacheKey)

    expect(cachedNodes).to.have.length(4)
    expect(redisGetSpy.callCount).to.be.equal(6)
    expect(redisSetSpy.callCount).to.be.equal(2)
  })

  describe('filterNodes function', () => {
    it('performs succesfull node filter', async () => {
      const relayStart = process.hrtime()

      const nodeChainChecks = await Promise.allSettled(
        DEFAULT_NODES.map((node) => nodeChecker.chain(node, CHAINCHECK_PAYLOAD, '0027', undefined, 100))
      )

      expect(nodeChainChecks).to.have.length(5)

      console.log(nodeChainChecks)
      const filteredNodes = await nodeCheckerWrapper['filterNodes']<ChainCheck>(
        'chain-check',
        DEFAULT_NODES,
        nodeChainChecks,
        '0027',
        pocketSession,
        '1234',
        relayStart,
        '5678',
        'abcd'
      )

      expect(filteredNodes).to.have.length(5)
    })

    it('fails node due to invalid chain check', async () => {
      const invalidChain = '{"id":1,"jsonrpc":"2.0","result":"0xc8"}' // 200
      const relayStart = process.hrtime()

      pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = [
        DEFAULT_CHAINCHECK_RESPONSE,
        DEFAULT_CHAINCHECK_RESPONSE,
        invalidChain,
        DEFAULT_CHAINCHECK_RESPONSE,
        new RpcError('90', MAX_RELAYS_ERROR),
      ]

      const pocket = pocketMock.object()

      nodeChecker = new NodeChecker(pocket, pocketConfiguration)
      nodeCheckerWrapper = new NodeCheckerWrapper(pocket, redis, metricsRecorder, ORIGIN)

      const nodeChainChecks = await Promise.allSettled(
        DEFAULT_NODES.map((node) => nodeChecker.chain(node, CHAINCHECK_PAYLOAD, '0027', undefined, 100))
      )

      expect(nodeChainChecks).to.have.length(5)

      const filteredNodes = await nodeCheckerWrapper['filterNodes']<ChainCheck>(
        'chain-check',
        DEFAULT_NODES,
        nodeChainChecks,
        '0027',
        pocketSession,
        '1234',
        relayStart,
        '5678',
        'abcd'
      )

      expect(filteredNodes).to.have.length(3)
    })
  })
})
