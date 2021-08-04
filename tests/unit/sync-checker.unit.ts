import { SyncChecker } from '../../src/services/sync-checker'
import RedisMock from 'ioredis-mock'
import { metricsRecorderMock } from '../mocks/metricsRecorder'
import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { CherryPicker } from '../../src/services/cherry-picker'
import { DEFAULT_NODES, PocketMock } from '../mocks/pocketjs'
import { Configuration } from '@pokt-network/pocket-js'
import { DEFAULT_POCKET_CONFIG } from '../../src/config/pocket-config'
import { expect } from '@loopback/testlab'
import { BlockchainsRepository } from '../../src/repositories/blockchains.repository'
import { gatewayTestDB } from '../fixtures/test.datasource'

const SYNC_ALLOWANCE = 5

const blockchain = {
  hash: '0021',
  ticker: 'ETH',
  networkID: '1',
  network: 'ETH-1',
  description: 'Ethereum Mainnet',
  index: 2,
  blockchain: 'eth-mainnet',
  active: true,
  enforceResult: 'JSON',
  nodeCount: 1,
  syncCheck: '{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}',
  // Does not actually exist on this chain, only for testing purposes
  syncCheckPath: '/v1/query/height',
  syncAllowance: 2,
}

describe('Sync checker service (unit)', () => {
  let syncChecker: SyncChecker
  let cherryPicker: CherryPicker
  let redis: RedisMock
  let metricsRecorder: MetricsRecorder
  let pocketMock: PocketMock
  let pocketConfiguration: Configuration
  let blockchainRepository: BlockchainsRepository

  before('initialize variables', async () => {
    redis = new RedisMock(0, '')
    cherryPicker = new CherryPicker({ redis, checkDebug: false })
    metricsRecorder = metricsRecorderMock(redis, cherryPicker)
    syncChecker = new SyncChecker(redis, metricsRecorder, SYNC_ALLOWANCE)
    blockchainRepository = new BlockchainsRepository(gatewayTestDB)

    pocketConfiguration = new Configuration(
      DEFAULT_POCKET_CONFIG.MAX_DISPATCHERS,
      DEFAULT_POCKET_CONFIG.MAX_SESSIONS,
      DEFAULT_POCKET_CONFIG.CONSENSUS_NODE_COUNT,
      DEFAULT_POCKET_CONFIG.REQUEST_TIMEOUT,
      DEFAULT_POCKET_CONFIG.ACCEPT_DISPUTED_RESPONSES,
      4,
      10200,
      DEFAULT_POCKET_CONFIG.VALIDATE_RELAY_RESPONSES,
      DEFAULT_POCKET_CONFIG.REJECT_SELF_SIGNED_CERTIFICATES,
      DEFAULT_POCKET_CONFIG.USE_LEGACY_TX_CODEC
    )
    pocketMock = new PocketMock(undefined, undefined, pocketConfiguration)

    const dbBlockchain = await blockchainRepository.create(blockchain)

    expect(dbBlockchain).to.be.deepEqual(blockchain)
  })

  const clean = async () => {
    await redis.flushall()
  }

  beforeEach(clean)

  it('should be defined', async () => {
    expect(syncChecker).to.be.ok()
  })

  it('updates the configuration consensus to one already set', () => {
    const configuration = new Configuration(
      DEFAULT_POCKET_CONFIG.MAX_DISPATCHERS,
      DEFAULT_POCKET_CONFIG.MAX_SESSIONS,
      9,
      DEFAULT_POCKET_CONFIG.REQUEST_TIMEOUT,
      DEFAULT_POCKET_CONFIG.ACCEPT_DISPUTED_RESPONSES,
      4,
      10200,
      DEFAULT_POCKET_CONFIG.VALIDATE_RELAY_RESPONSES,
      DEFAULT_POCKET_CONFIG.REJECT_SELF_SIGNED_CERTIFICATES,
      DEFAULT_POCKET_CONFIG.USE_LEGACY_TX_CODEC
    )

    const expectedConsensusCount = 5

    const newConfig = syncChecker.updateConfigurationConsensus(configuration)

    expect(newConfig.consensusNodeCount).to.be.equal(expectedConsensusCount)
  })

  it('updates the configuration request timeout to one already set', () => {
    const configuration = new Configuration(
      DEFAULT_POCKET_CONFIG.MAX_DISPATCHERS,
      DEFAULT_POCKET_CONFIG.MAX_SESSIONS,
      9,
      DEFAULT_POCKET_CONFIG.REQUEST_TIMEOUT,
      DEFAULT_POCKET_CONFIG.ACCEPT_DISPUTED_RESPONSES,
      4,
      10200,
      DEFAULT_POCKET_CONFIG.VALIDATE_RELAY_RESPONSES,
      DEFAULT_POCKET_CONFIG.REJECT_SELF_SIGNED_CERTIFICATES,
      DEFAULT_POCKET_CONFIG.USE_LEGACY_TX_CODEC
    )

    const expectedTimeout = 4000

    const newConfig = syncChecker.updateConfigurationTimeout(configuration)

    expect(newConfig.requestTimeOut).to.be.equal(expectedTimeout)
  })

  it('retrieves node sync log', () => {
    const node = DEFAULT_NODES[0]

    pocketMock.relayRequest = blockchain.syncCheck
    pocketMock.relayResponse = '{"id":1,"jsonrpc":"2.0","result":"0x64"}'
  })
})
