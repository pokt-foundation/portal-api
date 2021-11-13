import { expect } from '@loopback/testlab'
import { Configuration, RelayResponse, RpcError } from '@pokt-network/pocket-js'
import { getPocketConfigOrDefault } from '../../src/config/pocket-config'
import { NodeChecker } from '../../src/services/node-checker'
import { DEFAULT_NODES, PocketMock } from '../mocks/pocketjs'

// Chain check
const CHAINCHECK_PAYLOAD = '{"method":"eth_chainId","id":1,"jsonrpc":"2.0"}'
const DEFAULT_CHAINCHECK_RESPONSE = '{"id":1,"jsonrpc":"2.0","result":"0x64"}' // 100

// Sync Check
const SYNCCHECK_PAYLOAD = {
  body: '{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}',
  resultKey: 'result',
  allowance: 2,
}
const DEFAULT_SYNCHECK_RESPONSE = '{ "id": 1, "jsonrpc": "2.0", "result": "0x10a0c9c" }'

// Archival Check
const ARCHIVALCHECK_PAYLOAD = {
  body: '{"method":"eth_getBalance","params":["0x0000000000000000000000000000000000000000", "0x1"],"id":1,"jsonrpc":"2.0"}',
  bodyArray:
    '{"method":"eth_getBalance","params":["0x0000000000000000000000000000000000000000", "0x1"],"id":2,"jsonrpc":"2.0"}',
  resultKey: 'error.code',
  comparator: -32000,
}
const DEFAULT_ARCHIVALCHECK_RESPONSE = {
  normal:
    '{"error":{"code":-32000,"message":"This request is not supported because your node is running with state pruning. Run with --pruning=archive."},"id":1,"jsonrpc":"2.0"}',
  array:
    '[{"error":{"code":-32000,"message":"This request is not supported because your node is running with state pruning. Run with --pruning=archive."},"id":1,"jsonrpc":"2.0"}]',
}

describe('Node checker (unit)', () => {
  let pocketMock: PocketMock
  let pocketConfiguration: Configuration
  let nodeChecker: NodeChecker

  before('initialize variables', () => {
    pocketConfiguration = getPocketConfigOrDefault()
  })

  beforeEach(() => {
    pocketMock = new PocketMock(undefined, undefined, pocketConfiguration)
    pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = DEFAULT_CHAINCHECK_RESPONSE
    pocketMock.relayResponse[SYNCCHECK_PAYLOAD.body] = DEFAULT_SYNCHECK_RESPONSE
    pocketMock.relayResponse[ARCHIVALCHECK_PAYLOAD.body] = DEFAULT_ARCHIVALCHECK_RESPONSE.normal
    pocketMock.relayResponse[ARCHIVALCHECK_PAYLOAD.bodyArray] = DEFAULT_ARCHIVALCHECK_RESPONSE.array

    nodeChecker = new NodeChecker(pocketMock.object(), pocketConfiguration)
  })

  it('parses block from payload', async () => {
    const expectedResult = 100

    const result = NodeChecker.parseBlockFromPayload(JSON.parse(DEFAULT_CHAINCHECK_RESPONSE), 'result')

    expect(result).to.be.equal(expectedResult)
  })

  it('updates the configuration consensus to one already set', () => {
    const configuration = getPocketConfigOrDefault({ consensusNodeCount: 9 })
    const expectedConsensusCount = 5
    const newConfig = nodeChecker['updateConfigurationConsensus'](configuration)

    expect(newConfig.consensusNodeCount).to.be.equal(expectedConsensusCount)
  })

  it('updates the configuration request timeout to one already set', () => {
    const configuration = getPocketConfigOrDefault({
      requestTimeout: 10000,
    })
    const expectedTimeout = 4000
    const newConfig = nodeChecker['updateConfigurationTimeout'](configuration)

    expect(newConfig.requestTimeOut).to.be.equal(expectedTimeout)
  })

  it('sends a successful and failing relay', async () => {
    const successRelay = await nodeChecker['sendRelay'](CHAINCHECK_PAYLOAD, '0027', undefined)

    expect(successRelay).to.be.instanceOf(RelayResponse)

    pocketMock.fail = true

    const failingRelay = await nodeChecker['sendRelay'](CHAINCHECK_PAYLOAD, '0027', undefined)

    expect(failingRelay).to.be.instanceOf(Error)

    pocketMock.fail = false

    pocketMock.relayResponse[CHAINCHECK_PAYLOAD] = 'invalid jason'

    const failingRpcRelay = await nodeChecker['sendRelay'](CHAINCHECK_PAYLOAD, '0027', undefined)

    expect(failingRpcRelay).to.be.instanceOf(RpcError)
  })

  it('sends a consensus relay', async () => {
    // as long as it doesn't error then is all good, heavy work is within the blockchain
    const consensusRelay = await nodeChecker['sendConsensusRelay'](CHAINCHECK_PAYLOAD, '0027', undefined)

    expect(consensusRelay).to.be.instanceOf(RelayResponse)
  })

  it('compares a relayResponse against a helper function', async () => {
    // Comparator function, taken from chain check
    const isCorrectChain = (payload: object, chainIDArg) => {
      const nodeChainID = NodeChecker.parseBlockFromPayload(payload, 'result')

      return nodeChainID === chainIDArg
    }

    const successCheck = await nodeChecker['processCheck'](
      DEFAULT_NODES[0],
      CHAINCHECK_PAYLOAD,
      '0001',
      undefined,
      '',
      100,
      isCorrectChain
    )

    expect(successCheck.success).to.be.true()

    const failingCheck = await nodeChecker['processCheck'](
      DEFAULT_NODES[0],
      CHAINCHECK_PAYLOAD,
      '0001',
      undefined,
      '',
      200,
      isCorrectChain
    )

    expect(failingCheck.success).to.be.false()
  })

  it('performs successfull and failing chain check', async () => {
    const successChainCheck = await nodeChecker.chain(DEFAULT_NODES[0], CHAINCHECK_PAYLOAD, '0001', undefined, 100, '')

    expect(successChainCheck.success).to.be.true()

    const failingChainCheck = await nodeChecker.chain(DEFAULT_NODES[0], CHAINCHECK_PAYLOAD, '0001', undefined, 200, '')

    expect(failingChainCheck.success).to.be.false()

    pocketMock.fail = true

    const errorChainCheck = await nodeChecker.chain(DEFAULT_NODES[0], CHAINCHECK_PAYLOAD, '0001', undefined, 100, '')

    expect(errorChainCheck.success).to.be.false()
  })

  it('performs successfull and failing sync check', async () => {
    // With source
    const successSyncCheckSource = await nodeChecker.sync(
      DEFAULT_NODES[0],
      SYNCCHECK_PAYLOAD.body,
      '0001',
      undefined,
      SYNCCHECK_PAYLOAD.resultKey,
      '',
      17435804,
      5
    )

    expect(successSyncCheckSource.success).to.be.true()

    // Without source
    const successSyncCheck = await nodeChecker.sync(
      DEFAULT_NODES[0],
      SYNCCHECK_PAYLOAD.body,
      '0001',
      undefined,
      SYNCCHECK_PAYLOAD.resultKey,
      '',
      0,
      5
    )

    expect(successSyncCheck.success).to.be.true()

    const failingSyncCheck = await nodeChecker.sync(
      DEFAULT_NODES[0],
      SYNCCHECK_PAYLOAD.body,
      '0001',
      undefined,
      SYNCCHECK_PAYLOAD.resultKey,
      '',
      17435834,
      5
    )

    expect(failingSyncCheck.success).to.be.false()

    pocketMock.fail = true

    const errorSyncCheck = await nodeChecker.sync(
      DEFAULT_NODES[0],
      SYNCCHECK_PAYLOAD.body,
      '0001',
      undefined,
      SYNCCHECK_PAYLOAD.resultKey,
      '',
      17435834,
      5
    )

    expect(errorSyncCheck.success).to.be.false()
  })

  it('performs successfull and failing archival check', async () => {
    const successArchivalCheck = await nodeChecker.archival(
      DEFAULT_NODES[0],
      ARCHIVALCHECK_PAYLOAD.body,
      '0001',
      undefined,
      ARCHIVALCHECK_PAYLOAD.resultKey,
      ARCHIVALCHECK_PAYLOAD.comparator
    )

    expect(successArchivalCheck.success).to.be.true()

    console.log('LLEGAMO AQUI')
    const successArchivalCheckArray = await nodeChecker.archival(
      DEFAULT_NODES[0],
      ARCHIVALCHECK_PAYLOAD.bodyArray,
      '0001',
      undefined,
      ARCHIVALCHECK_PAYLOAD.resultKey,
      ARCHIVALCHECK_PAYLOAD.comparator
    )

    expect(successArchivalCheckArray.success).to.be.true()

    const failingArchivalCheck = await nodeChecker.archival(
      DEFAULT_NODES[0],
      ARCHIVALCHECK_PAYLOAD.body,
      '0001',
      undefined,
      ARCHIVALCHECK_PAYLOAD.resultKey,
      '100'
    )

    expect(failingArchivalCheck.success).to.be.false()

    pocketMock.fail = true

    const errorArchivalCheck = await nodeChecker.archival(
      DEFAULT_NODES[0],
      ARCHIVALCHECK_PAYLOAD.body,
      '0001',
      undefined,
      ARCHIVALCHECK_PAYLOAD.resultKey,
      ARCHIVALCHECK_PAYLOAD.comparator
    )

    expect(errorArchivalCheck.success).to.be.false()
  })
})
