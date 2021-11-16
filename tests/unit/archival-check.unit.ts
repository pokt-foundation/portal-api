import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import RedisMock from 'ioredis-mock'
import { expect, sinon } from '@loopback/testlab'
import { Configuration, Session, RpcError } from '@pokt-network/pocket-js'

import { getPocketConfigOrDefault } from '../../src/config/pocket-config'
import { ArchivalChecker } from '../../src/services/archival-check'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { MAX_RELAYS_ERROR } from '../../src/utils/constants'
import { hashBlockchainNodes } from '../../src/utils/helpers'
import { metricsRecorderMock } from '../mocks/metrics-recorder'
import { DEFAULT_NODES, PocketMock } from '../mocks/pocketjs'

const ARCHIVALCHECK_PAYLOAD = {
  body: '{"method":"eth_getBalance","params":["0x0000000000000000000000000000000000000000", "0x1"],"id":1,"jsonrpc":"2.0"}',
  resultKey: 'error.code',
  comparator: -32000,
  path: '',
}

const DEFAULT_ARCHIVALCHECK_RESPONSE =
  '{"error":{"code":-32000,"message":"This request is not supported because your node is running with state pruning. Run with --pruning=archive."},"id":1,"jsonrpc":"2.0"}'

describe('Archival checker new service (unit)', () => {
  let metricsRecorder: MetricsRecorder
  let redis: RedisMock
  let cherryPicker: CherryPicker
  let pocketConfiguration: Configuration
  let pocketMock: PocketMock
  let axiosMock: MockAdapter
  let archivalChecker: ArchivalChecker
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
    pocketMock.relayResponse[ARCHIVALCHECK_PAYLOAD.body] = DEFAULT_ARCHIVALCHECK_RESPONSE
    const pocket = pocketMock.object()

    pocketSession = (await pocket.sessionManager.getCurrentSession(
      undefined,
      undefined,
      undefined,
      undefined
    )) as Session

    archivalChecker = new ArchivalChecker(pocket, redis, metricsRecorder, 'archival-check')

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
    expect(archivalChecker).to.be.ok()
  })

  it('performs the archival check successfully', async () => {
    const redisGetSpy = sinon.spy(redis, 'get')
    const redisSetSpy = sinon.spy(redis, 'set')

    pocketMock.relayResponse[ARCHIVALCHECK_PAYLOAD.body] = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0c9c" }'

    const pocketClient = pocketMock.object()

    archivalChecker = new ArchivalChecker(pocketClient, redis, metricsRecorder, '')

    let checkedNodes = await archivalChecker.check({
      nodes: DEFAULT_NODES,
      archivalCheckOptions: ARCHIVALCHECK_PAYLOAD,
      blockchainID: '0027',
      pocketAAT: undefined,
      pocketConfiguration,
      pocketSession,
      applicationID: '1234',
      applicationPublicKey: '5678',
      requestID: 'abcd',
    })

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(5)

    expect(redisGetSpy.callCount).to.be.equal(7)
    expect(redisSetSpy.callCount).to.be.equal(7)

    // Subsequent calls should retrieve results from redis instead
    checkedNodes = await archivalChecker.check({
      nodes: DEFAULT_NODES,
      archivalCheckOptions: ARCHIVALCHECK_PAYLOAD,
      blockchainID: '0027',
      pocketAAT: undefined,
      pocketConfiguration,
      pocketSession,
      applicationID: '1234',
      applicationPublicKey: '5678',
      requestID: 'abcd',
    })

    expect(redisGetSpy.callCount).to.be.equal(8)
    expect(redisSetSpy.callCount).to.be.equal(7)
  })

  it('fails the archival check', async () => {
    const checkedNodes = await archivalChecker.check({
      nodes: DEFAULT_NODES,
      archivalCheckOptions: ARCHIVALCHECK_PAYLOAD,
      blockchainID: '0027',
      pocketAAT: undefined,
      pocketConfiguration,
      pocketSession,
      applicationID: '1234',
      applicationPublicKey: '5678',
      requestID: 'abcd',
    })

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(0)
  })

  it('Fails the archival check due to max relays error on a node', async () => {
    const nonArchivalResponse = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0c9c" }'
    const blockchainID = '0027'

    // Fails last node due to max relays
    pocketMock.relayResponse[ARCHIVALCHECK_PAYLOAD.body] = [
      nonArchivalResponse,
      nonArchivalResponse,
      nonArchivalResponse,
      nonArchivalResponse,
      new RpcError('90', MAX_RELAYS_ERROR),
    ]

    const pocketClient = pocketMock.object()

    archivalChecker = new ArchivalChecker(pocketClient, redis, metricsRecorder, '')

    const checkedNodes = await archivalChecker.check({
      nodes: DEFAULT_NODES,
      archivalCheckOptions: ARCHIVALCHECK_PAYLOAD,
      blockchainID: '0027',
      pocketAAT: undefined,
      pocketConfiguration,
      pocketSession,
      applicationID: '1234',
      applicationPublicKey: '5678',
      requestID: 'abcd',
    })

    expect(checkedNodes).to.be.Array()
    expect(checkedNodes).to.have.length(4)

    const removedNode = await redis.smembers(`session-${hashBlockchainNodes(blockchainID, pocketSession.sessionNodes)}`)

    expect(removedNode).to.have.length(1)
  })
})
