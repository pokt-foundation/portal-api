import { Redis } from 'ioredis'
import RedisMock from 'ioredis-mock'
import { expect, sinon } from '@loopback/testlab'
import { NodeSticker } from '../../src/services/node-sticker'
import { DEFAULT_NODES } from '../mocks/pocketjs'

const logger = require('../../src/services/logger')

const NODES = [DEFAULT_NODES[0], DEFAULT_NODES[1]]

const DEFAULT_STICKINESS_OPTIONS = {
  stickiness: true,
  duration: 20,
  useRPCID: false,
  relaysLimit: 10,
  stickyOrigins: [],
  keyPrefix: 'prefix',
  preferredNodeAddress: NODES[0].address,
  rpcIDThreshold: 5,
}

const BLOCKCHAIN_ID = '0001'
const IP_ADDRESS = '127.0.0.1'
const DATA = '{"method":"eth_blockNumber","params":[],"id":1,"jsonrpc":"2.0"}'
const REQUEST_ID = 'abcde'
const TYPE_ID = '123456789abcde'

describe('Node sticker service (unit)', () => {
  let redis: Redis
  let nodeSticker: NodeSticker
  let logSpy: sinon.SinonSpy

  before('initialize variables', async () => {
    logSpy = sinon.spy(logger, 'log')

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

  beforeEach(async () => {
    await redis.flushall()
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
    let relayPublicKey = NODES[1].publicKey

    expect(await NodeSticker.stickyRelayResult(preferredNodeAddress, relayPublicKey)).to.be.equal('NONE')

    preferredNodeAddress = DEFAULT_STICKINESS_OPTIONS.preferredNodeAddress

    expect(await NodeSticker.stickyRelayResult(preferredNodeAddress, relayPublicKey)).to.be.equal('FAILURE')

    relayPublicKey = NODES[0].publicKey

    expect(await NodeSticker.stickyRelayResult(preferredNodeAddress, relayPublicKey)).to.be.equal('SUCCESS')
  })

  describe('setStickinessKey function', function () {
    it('sets the stickiness key for a node using prefix', async function () {
      let cached = await redis.get(nodeSticker.clientStickyKey)

      expect(cached).to.be.equal(null)

      await nodeSticker.setStickinessKey(TYPE_ID, DEFAULT_STICKINESS_OPTIONS.preferredNodeAddress, '', false)

      cached = await redis.get(nodeSticker.clientStickyKey)

      expect(cached).to.not.be.equal(null)
      expect(JSON.parse(cached)).to.have.properties('applicationID', 'nodeAddress')
    })

    it('sets the stickiness key for a node using rpcID', async function () {
      let rpcID = 1
      // const nextRPCID = NodeSticker.getNextRPCID(rpcID, DATA)

      nodeSticker = new NodeSticker(
        { ...DEFAULT_STICKINESS_OPTIONS, keyPrefix: '', rpcID },
        BLOCKCHAIN_ID,
        IP_ADDRESS,
        redis,
        DATA,
        REQUEST_ID,
        TYPE_ID
      )

      let cached = await redis.get(nodeSticker.clientStickyKey)

      expect(cached).to.be.equal(null)

      await nodeSticker.setStickinessKey(TYPE_ID, DEFAULT_STICKINESS_OPTIONS.preferredNodeAddress, '', false)

      cached = await redis.get(nodeSticker.clientStickyKey)

      expect(cached).to.not.be.equal(null)

      // Is better to not test for the current sticky key as is may change in the future and better get an approximation
      const keys = await redis.keys('*')

      expect(keys).to.have.length(DEFAULT_STICKINESS_OPTIONS.rpcIDThreshold)

      for (let i = 0; i < DEFAULT_STICKINESS_OPTIONS.rpcIDThreshold; i++) {
        const rpcData = JSON.parse(await redis.get(keys[i]))

        const nextRPCID = NodeSticker.getNextRPCID(rpcID, DATA)

        rpcID = nextRPCID

        expect(rpcData).to.have.properties('applicationID', 'nodeAddress')

        // All the set data should be the same
        if (i > 0) {
          const previousrpcData = JSON.parse(await redis.get(keys[i - 1]))

          expect(rpcData).to.be.deepEqual(previousrpcData)
        }
      }
    })

    it("doesn't set the stickiness key due to invalid origin", async function () {
      nodeSticker = new NodeSticker(
        { ...DEFAULT_STICKINESS_OPTIONS, stickyOrigins: ['https://an-origin'] },
        BLOCKCHAIN_ID,
        IP_ADDRESS,
        redis,
        DATA,
        REQUEST_ID,
        TYPE_ID
      )

      let cached = await redis.get(nodeSticker.clientStickyKey)

      expect(cached).to.be.equal(null)

      await nodeSticker.setStickinessKey(
        TYPE_ID,
        DEFAULT_STICKINESS_OPTIONS.preferredNodeAddress,
        'invalid-origin',
        false
      )

      cached = await redis.get(nodeSticker.clientStickyKey)

      expect(cached).to.be.equal(null)
    })
  })

  describe('getStickyNode function', function () {
    it('gets a node saved from sticky cache', async function () {
      nodeSticker = new NodeSticker(
        { ...DEFAULT_STICKINESS_OPTIONS, preferredNodeAddress: '' },
        BLOCKCHAIN_ID,
        IP_ADDRESS,
        redis,
        DATA,
        REQUEST_ID,
        TYPE_ID
      )

      let node = await nodeSticker.getStickyNode(DEFAULT_NODES, [])

      expect(node).to.be.equal(undefined)

      await nodeSticker.setStickinessKey(TYPE_ID, DEFAULT_STICKINESS_OPTIONS.preferredNodeAddress, '', false)

      nodeSticker.preferredNodeAddress = DEFAULT_STICKINESS_OPTIONS.preferredNodeAddress

      node = await nodeSticker.getStickyNode(DEFAULT_NODES, [])

      expect(node.address).to.be.equal(nodeSticker.preferredNodeAddress)
    })

    it('doesn\t get node due to not being in the nodes array', async function () {
      nodeSticker = new NodeSticker(
        { ...DEFAULT_STICKINESS_OPTIONS, preferredNodeAddress: '' },
        BLOCKCHAIN_ID,
        IP_ADDRESS,
        redis,
        DATA,
        REQUEST_ID,
        TYPE_ID
      )

      const node = await nodeSticker.getStickyNode(
        DEFAULT_NODES.filter((n) => n.address !== nodeSticker.preferredNodeAddress),
        []
      )

      expect(node).to.be.equal(undefined)
    })

    it('doesn\t get node due to node being exhausted, removes node from cache', async function () {
      nodeSticker = new NodeSticker(
        DEFAULT_STICKINESS_OPTIONS,
        BLOCKCHAIN_ID,
        IP_ADDRESS,
        redis,
        DATA,
        REQUEST_ID,
        TYPE_ID
      )

      const node = await nodeSticker.getStickyNode(DEFAULT_NODES, [
        DEFAULT_NODES.find((n) => n.address === nodeSticker.preferredNodeAddress).publicKey,
      ])

      expect(node).to.be.equal(undefined)

      const expectedLog = logSpy.calledWith(
        'warn',
        sinon.match((arg: string) => arg.startsWith('sticky node forcefully removed')),
        sinon.match((log: object) => log['reason'] === 'exhausted node')
      )

      expect(expectedLog).to.be.true()
    })

    it('doesn\t get node due to node exceeding error count, removes node from cache', async function () {
      nodeSticker = new NodeSticker(
        DEFAULT_STICKINESS_OPTIONS,
        BLOCKCHAIN_ID,
        IP_ADDRESS,
        redis,
        DATA,
        REQUEST_ID,
        TYPE_ID
      )

      for (let i = 0; i < 10; i++) {
        await redis.incr(nodeSticker.clientErrorKey)
      }

      const node = await nodeSticker.getStickyNode(DEFAULT_NODES, [])

      expect(node).to.be.equal(undefined)

      const expectedLog = logSpy.calledWith(
        'warn',
        sinon.match((arg: string) => arg.startsWith('sticky node forcefully removed')),
        sinon.match((log: object) => log['reason'] === 'error limit exceeded')
      )

      expect(expectedLog).to.be.true()
    })
  })

  it('removes node on relay limit exceeded', async function () {
    nodeSticker = new NodeSticker(
      DEFAULT_STICKINESS_OPTIONS,
      BLOCKCHAIN_ID,
      IP_ADDRESS,
      redis,
      DATA,
      REQUEST_ID,
      TYPE_ID
    )

    for (let i = 0; i < DEFAULT_STICKINESS_OPTIONS.relaysLimit * 2; i++) {
      await redis.incr(nodeSticker.clientLimitKey)
    }

    await nodeSticker.checkRelaysLimit()

    const expectedLog = logSpy.calledWith(
      'warn',
      sinon.match((arg: string) => arg.startsWith('sticky node forcefully removed')),
      sinon.match((log: object) => log['reason'] === 'relays limit exceeded')
    )

    expect(expectedLog).to.be.true()
  })

  it('removes node stickiness', async function () {
    nodeSticker = new NodeSticker(
      DEFAULT_STICKINESS_OPTIONS,
      BLOCKCHAIN_ID,
      IP_ADDRESS,
      redis,
      DATA,
      REQUEST_ID,
      TYPE_ID
    )

    await nodeSticker.setStickinessKey(TYPE_ID, DEFAULT_STICKINESS_OPTIONS.preferredNodeAddress, '', false)

    for (let i = 0; i < 5; i++) {
      await redis.incr(nodeSticker.clientLimitKey)
      await redis.incr(nodeSticker.clientErrorKey)
    }

    await nodeSticker.checkRelaysLimit()

    let keys = await redis.keys('*')

    expect(keys).to.have.length(3)

    await nodeSticker.remove()

    keys = await redis.keys('*')

    expect(keys).to.have.length(0)

    const expectedLog = logSpy.calledWith(
      'warn',
      sinon.match((arg: string) => arg.startsWith('sticky node forcefully removed'))
    )

    expect(expectedLog).to.be.true()
  })

  it('increases and retrieves error count', async function () {
    nodeSticker = new NodeSticker(
      DEFAULT_STICKINESS_OPTIONS,
      BLOCKCHAIN_ID,
      IP_ADDRESS,
      redis,
      DATA,
      REQUEST_ID,
      TYPE_ID
    )

    let errorCount = await nodeSticker.getErrorCount()

    expect(errorCount).to.be.equal(0)

    errorCount = await nodeSticker.increaseErrorCount()

    expect(errorCount).to.be.equal(1)
  })
})
