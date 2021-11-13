import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import RedisMock from 'ioredis-mock'
import { expect, sinon } from '@loopback/testlab'
import { Configuration, Session, RpcError } from '@pokt-network/pocket-js'

import { getPocketConfigOrDefault } from '../../src/config/pocket-config'
import { PocketChainChecker } from '../../src/services/chain-checker-new'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { MAX_RELAYS_ERROR } from '../../src/utils/constants'
import { hashBlockchainNodes } from '../../src/utils/helpers'
import { metricsRecorderMock } from '../mocks/metrics-recorder'
import { DEFAULT_NODES, PocketMock } from '../mocks/pocketjs'

const CHAINCHECK_PAYLOAD = '{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'

const DEFAULT_CHAINCHECK_RESPONSE = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'

describe('Chain checker new service (unit)', () => {
  let metricsRecorder: MetricsRecorder
  let redis: RedisMock
  let cherryPicker: CherryPicker
  let pocketConfiguration: Configuration
  let pocketMock: PocketMock
  let axiosMock: MockAdapter
  let chainChecker: PocketChainChecker
  let pocketSession: Session

  before('initialize variables', async () => {
    redis = new RedisMock(0, '')
    cherryPicker = new CherryPicker({ redis, checkDebug: false })
    metricsRecorder = metricsRecorderMock(redis, cherryPicker)
    pocketConfiguration = getPocketConfigOrDefault()

    axiosMock = new MockAdapter(axios)
    axiosMock.onPost('https://user:pass@backups.example.org:18081/v1/query/node').reply(200, {
      service_url: 'https://localhost:443',
    })
  })

  beforeEach(async () => {
    pocketMock = new PocketMock()
    pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = DEFAULT_CHAINCHECK_RESPONSE
    const pocket = pocketMock.object()

    pocketSession = (await pocket.sessionManager.getCurrentSession(undefined, undefined, undefined)) as Session

    chainChecker = new PocketChainChecker(pocket, redis, metricsRecorder, pocketSession, 'chain-check')

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

  it('performs the chain check successfully', async () => {
    const nodes = DEFAULT_NODES

    const chainID = 100
    const redisGetSpy = sinon.spy(redis, 'get')
    const redisSetSpy = sinon.spy(redis, 'set')

    let checkedNodes = await chainChecker.check(
      nodes,
      CHAINCHECK_PAYLOAD,
      chainID,
      '0027',
      undefined,
      pocketConfiguration,
      '1234',
      '5678',
      'abcd'
    )

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(5)

    expect(redisGetSpy.callCount).to.be.equal(7)
    expect(redisSetSpy.callCount).to.be.equal(7)

    // Subsequent calls should retrieve results from redis instead
    checkedNodes = await chainChecker.check(
      nodes,
      CHAINCHECK_PAYLOAD,
      chainID,
      '0027',
      undefined,
      pocketConfiguration,
      '1234',
      '5678',
      'abcd'
    )

    expect(redisGetSpy.callCount).to.be.equal(8)
    expect(redisSetSpy.callCount).to.be.equal(7)
  })

  it('fails the chain check', async () => {
    const nodes = DEFAULT_NODES

    // Default nodes are set with a chainID of 100
    pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = '{"id":1,"jsonrpc":"2.0","result":"0xC8"}' // 0xC8 to base 10: 200

    const pocketClient = pocketMock.object()
    const chainID = 100
    const pocketChainChecker = new PocketChainChecker(pocketClient, redis, metricsRecorder, pocketSession, '')
    const checkedNodes = await pocketChainChecker.check(
      nodes,
      CHAINCHECK_PAYLOAD,
      chainID,
      '0027',
      undefined,
      pocketConfiguration,
      '1234',
      '5678',
      'abcd'
    )

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(0)
  })

  it('Fails the chain check due to max relays error on a node', async () => {
    const nodes = DEFAULT_NODES
    const blockchainID = '0027'

    // Fails last node due to max relays
    pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = [
      DEFAULT_CHAINCHECK_RESPONSE,
      DEFAULT_CHAINCHECK_RESPONSE,
      DEFAULT_CHAINCHECK_RESPONSE,
      DEFAULT_CHAINCHECK_RESPONSE,
      new RpcError('90', MAX_RELAYS_ERROR),
    ]

    const pocketClient = pocketMock.object()
    const chainID = 100

    const pocketChainChecker = new PocketChainChecker(pocketClient, redis, metricsRecorder, pocketSession, '')
    const checkedNodes = await pocketChainChecker.check(
      nodes,
      CHAINCHECK_PAYLOAD,
      chainID,
      '0027',
      undefined,
      pocketConfiguration,
      '1234',
      '5678',
      'abcd'
    )

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(4)

    const removedNode = await redis.smembers(`session-${hashBlockchainNodes(blockchainID, pocketSession.sessionNodes)}`)

    expect(removedNode).to.have.length(1)
  })
})
