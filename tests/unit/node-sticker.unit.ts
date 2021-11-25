import { Redis } from 'ioredis'
import RedisMock from 'ioredis-mock'
import { expect } from '@loopback/testlab'
import { NodeSticker } from '../../src/services/node-sticker'
import { DEFAULT_NODES } from '../mocks/pocketjs'

const DEFAULT_STICKINESS_OPTIONS = {
  stickiness: true,
  duration: 20,
  useRPCID: false,
  relaysLimit: 10,
  stickyOrigins: [],
  keyPrefix: 'prefix',
  preferredNodeAddress: DEFAULT_NODES[0].address,
}

const BLOCKCHAIN_ID = '0001'
const IP_ADDRESS = '127.0.0.1'
const DATA = '{"method":"eth_blockNumber","params":[],"id":1,"jsonrpc":"2.0"}'
const REQUEST_ID = 'abcde'
const TYPE_ID = '123456789abcde'

describe('Node sticker service (unit)', () => {
  let redis: Redis
  let nodeSticker: NodeSticker

  before('initialize variables', async () => {
    redis = new RedisMock(0, '')

    nodeSticker = new NodeSticker(
      DEFAULT_STICKINESS_OPTIONS,
      BLOCKCHAIN_ID,
      IP_ADDRESS,
      redis,
      DATA,
      REQUEST_ID,
      TYPE_ID
    )
  })

  it('should be defined', async () => {
    expect(nodeSticker).to.be.ok()
  })

  it('retrieves next rpcID from request payload', function () {
    const rpcID = 1

    expect(NodeSticker.getNextRPCID(rpcID, DATA)).to.be.equal(2)
  })

  it('retrieves whether sticky responses was succesfull (used the same node)', async function () {
    let preferredNodeAddress = ''
    let relayPublicKey = DEFAULT_NODES[1].publicKey

    expect(await NodeSticker.stickyRelayResult(preferredNodeAddress, relayPublicKey)).to.be.equal('NONE')

    preferredNodeAddress = DEFAULT_STICKINESS_OPTIONS.preferredNodeAddress

    expect(await NodeSticker.stickyRelayResult(preferredNodeAddress, relayPublicKey)).to.be.equal('FAILURE')

    relayPublicKey = DEFAULT_NODES[0].publicKey

    expect(await NodeSticker.stickyRelayResult(preferredNodeAddress, relayPublicKey)).to.be.equal('SUCCESS')
  })
})
