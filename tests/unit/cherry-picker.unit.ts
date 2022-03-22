import { Node } from '@pokt-foundation/pocketjs-types'
import RedisMock from 'ioredis-mock'
import { expect } from '@loopback/testlab'
import { Applications } from '../../src/models'
import { CherryPicker } from '../../src/services/cherry-picker'
import { PocketMock } from '../mocks/pocketjs'

describe('Cherry p  icker service (unit)', () => {
  let cherryPicker: CherryPicker
  let redis: RedisMock

  before('initialize instance', async () => {
    redis = new RedisMock(0, '')

    cherryPicker = new CherryPicker({ redis, checkDebug: true, archivalChains: ['1234', '4567'] })
  })

  const cleanCache = async () => {
    await redis.flushall()
  }

  beforeEach(cleanCache)

  describe('cherryPickNode function', () => {
    it('picks a node based on success rate and failure', async () => {
      const nodes: Partial<Node>[] = [
        {
          address: '049f685d89cdd18d',
          chains: ['0001', '0003', '0004', '0005', '0009', '0024'],
          publicKey: 'd2fd328ecb3dxca0s',
        },
        {
          address: 'd4c9208c2sa9fgc0',
          chains: ['0001', '0003', '0004', '0005', '0027', '0021'],
          publicKey: '344ddd770e13fe88d',
        },
        {
          address: '74d9f531415e8c4d',
          chains: ['0001', '0003', '0004', '0005', '0021', '0027'],
          publicKey: 'dcod9Dd8ce16122c9a1d9bb261bb8f315752bd1',
        },
        {
          address: '74d9f531415e21d',
          chains: ['0001', '0003', '0002', '0001', '0011', '0020'],
          publicKey: '234894ds8D7s122c9a1d9b8e987e209024a2bd1',
        },
        {
          address: '74d9f5ffd9se211ba703df8c4d',
          chains: ['0001', '0003', '0002', '0001', '0012', '0020'],
          publicKey: '234894ds8D7s12b1232360a18esdd209024a2bd1',
        },
      ]

      const app: Partial<Applications> = {
        id: '24676c9f7sf4552f0b9cad',
        freeTier: true,
      }

      const blockchain = '0027'

      // Simulate nodes already cached. Several behaviors tested:
      // Basic already logged, logged only with error rates, set as failure
      // with and without recover
      await redis.set(
        blockchain + '-' + nodes[0].publicKey + '-service',
        JSON.stringify({
          results: { '200': 1, '500': 2 },
          weightedSuccessLatency: '1.79778',
        }),
        'EX',
        120
      )
      await redis.set(
        blockchain + '-' + nodes[1].publicKey + '-service',
        JSON.stringify({
          results: { '200': 4 },
          weightedSuccessLatency: '0.57491',
        }),
        'EX',
        120
      )
      await redis.set(
        blockchain + '-' + nodes[2].publicKey + '-service',
        JSON.stringify({
          results: { '500': 6 },
          weightedSuccessLatency: '2.57491',
        }),
        'EX',
        120
      )
      await redis.set(blockchain + '-' + nodes[4].publicKey + '-failure', 'true', 'EX', 120)
      await redis.set(blockchain + '-' + nodes[0].publicKey + '-failure', 'true', 'EX', 120)

      // @ts-ignore
      const node = await cherryPicker.cherryPickNode(app, nodes, blockchain, '34sfDg', '')

      expect(node).to.be.ok()
      expect(node).to.be.Object()

      // Previously marked node as failure should be cleaned
      const cleanedNode = await redis.get(blockchain + '-' + nodes[0].publicKey + '-failure')

      expect(cleanedNode).to.to.be.equal('false')

      // Node should continue flagged as failure
      const failureNode = await redis.get(blockchain + '-' + nodes[4].publicKey + '-failure')

      expect(failureNode).to.be.equal('true')
    })

    it('picks a node when all of them are failures', async () => {
      const nodes: Partial<Node>[] = [
        {
          address: '049f685d89cdd18d',
          chains: ['0001', '0003', '0004', '0005', '0009', '0024'],
          publicKey: 'd2fd328ecb3dxca0s',
        },
        {
          address: 'd4c9208c2sa9fgc0',
          chains: ['0001', '0003', '0004', '0005', '0027', '0021'],
          publicKey: '344ddd770e13fe88d',
        },
        {
          address: '74d9f531415e8c4d',
          chains: ['0001', '0003', '0004', '0005', '0021', '0027'],
          publicKey: 'dcod9Dd8ce16122c9a1d9bb261bb8f315752bd1',
        },
        {
          address: '74d9f531415e21d',
          chains: ['0001', '0003', '0002', '0001', '0011', '0020'],
          publicKey: '234894ds8D7s122c9a1d9b8e987e209024a2bd1',
        },
        {
          address: '74d9f5ffd9se211ba703df8c4d',
          chains: ['0001', '0003', '0002', '0001', '0012', '0020'],
          publicKey: '234894ds8D7s12b1232360a18esdd209024a2bd1',
        },
      ]

      const app: Partial<Applications> = {
        id: '24676c9f7sf4552f0b9cad',
        freeTier: true,
      }

      const blockchain = '0027'

      for (const node of nodes) {
        await redis.set(
          blockchain + '-' + node.publicKey + '-service',
          JSON.stringify({
            results: { '500': 4 },
            weightedSuccessLatency: '1',
          }),
          'EX',
          120
        )
        await redis.set(blockchain + '-' + node.publicKey + '-failure', 'true', 'EX', 120)
      }

      // @ts-ignore
      const pickedNode = await cherryPicker.cherryPickNode(app, nodes, blockchain, '34sfDg', '')

      expect(pickedNode).to.be.ok()
      expect(pickedNode).to.be.Object()

      // All nodes should continue being failures
      for (const node of nodes) {
        const failureNode = await redis.get(blockchain + '-' + node.publicKey + '-failure')

        expect(failureNode).to.be.equal('true')
      }
    })
  })

  describe('createUnsortedLog function', () => {
    it('creates an unsorted log for an unused node', async () => {
      const expectedServiceLog = {
        id: 'fd4f41fe0f04a20226',
        attempts: 0,
        successRate: 1,
        medianSuccessLatency: 0,
        weightedSuccessLatency: 0,
        failure: false,
      }

      const serviceLog = await cherryPicker.createUnsortedLog('fd4f41fe0f04a20226', '0027', '')

      expect(serviceLog).to.be.deepEqual(expectedServiceLog)
    })

    it('creates an unsorted log for an used node', async () => {
      const rawLog = '{"results":{"200":1},"medianSuccessLatency":"0.145","weightedSuccessLatency":"0.30820"}'

      const expectedServiceLog = {
        id: 'fd4f41fe0f04a20226',
        attempts: 1,
        successRate: 1,
        medianSuccessLatency: 0.145,
        weightedSuccessLatency: 0.3082,
        failure: false,
      }

      const serviceLog = await cherryPicker.createUnsortedLog('fd4f41fe0f04a20226', '0027', rawLog)

      expect(serviceLog).to.be.deepEqual(expectedServiceLog)
    })

    it('removes the failure status from a previously marked node', async () => {
      const rawLog = '{"results":{"200":1},"medianSuccessLatency":"0.145","weightedSuccessLatency":"0.30820"}'
      const id = 'fd4f41fe0f04a20226'
      const blockchain = '0027'
      let failureNode: string

      const expectedServiceLog = {
        id: 'fd4f41fe0f04a20226',
        attempts: 1,
        successRate: 1,
        medianSuccessLatency: 0.145,
        weightedSuccessLatency: 0.3082,
        failure: false,
      }

      await redis.set(blockchain + '-' + id + '-failure', true, 'EX', 60)
      failureNode = await redis.get(blockchain + '-' + id + '-failure')

      expect(failureNode).to.be.equal('true')

      const serviceLog = await cherryPicker.createUnsortedLog('fd4f41fe0f04a20226', '0027', rawLog)

      expect(serviceLog).to.be.deepEqual(expectedServiceLog)

      failureNode = await redis.get(blockchain + '-' + id + '-failure')
      expect(failureNode).to.be.equal('false')
    })
  })

  describe('updateServiceQuality function', () => {
    it('updates the logs for a service not on cache', async () => {
      const id = '48d7fsgcvy8ahos'
      const blockchain = '0027'
      const elapseTime = 0.22333
      const result = 500
      const expectedLogs = JSON.stringify({
        medianSuccessLatency: '0.00000',
        weightedSuccessLatency: '0.00000',
        results: {
          [result]: 1,
        },
      })
      let logs: string

      // no values set for the service yet
      logs = await redis.get(blockchain + '-' + id + '-service')
      expect(logs).to.be.null()

      await cherryPicker.updateServiceQuality(blockchain, 'appID', id, elapseTime, result)

      logs = await redis.get(blockchain + '-' + id + '-service')
      expect(JSON.parse(logs)).to.be.deepEqual(JSON.parse(expectedLogs))
    })

    it('updates the logs for a service already cached', async () => {
      const id = '48d7fsgcvy8ahos'
      const blockchain = '0027'
      const elapseTime = 0.22333 // logs are set to be up to 5 decimal points
      const result = 200
      const expectedLogs = JSON.stringify({
        medianSuccessLatency: '0.25000',
        weightedSuccessLatency: '0.38100', // average after calculation from fn
        results: {
          '200': 25,
          '500': 2,
        },
      })

      await redis.set(blockchain + '-' + id + '-relayTimingLog', JSON.stringify([0.245, 0.255, 0.265]), 'EX', 60)

      await redis.set(
        blockchain + '-' + id + '-service',
        '{"results":{"200":24,"500":2},"medianSuccessLatency":"0.145","weightedSuccessLatency":"1.79778"}',
        'EX',
        60
      )

      await cherryPicker.updateServiceQuality(blockchain, 'appID', id, elapseTime, result)
      const logs = await redis.get(blockchain + '-' + id + '-service')

      expect(JSON.parse(logs)).to.be.deepEqual(JSON.parse(expectedLogs))
    })

    it('updates node timeout quality on archival', async () => {
      const nodePublicKey = 'e8ec4vog1ilaozhbank9l0pbaomqi6xhe0qcb6qwb2mi8qxjf8yim3ddehcif0fg'
      const blockchain = '1234'
      const elapsedTime = 2.5
      const requestTimeout = 10

      const session = await new PocketMock().object().getNewSession(undefined)

      await cherryPicker.updateBadNodeTimeoutQuality(blockchain, nodePublicKey, elapsedTime, requestTimeout, session)

      const sessionCachedKey = `session-key-${session.key}`

      let removedNodes = await redis.smembers(sessionCachedKey)

      expect(removedNodes).to.have.length(0)

      // Force a node removal
      for (let i = 0; i <= 20; i++) {
        await cherryPicker.updateBadNodeTimeoutQuality(blockchain, nodePublicKey, elapsedTime, requestTimeout, session)
      }

      removedNodes = await redis.smembers(sessionCachedKey)

      expect(removedNodes).to.have.length(1)
    })
  })

  it('should be defined', () => {
    expect(cherryPicker).to.be.ok()
  })

  it('sort logs based on average latency', () => {
    const unsortedLogs = [
      {
        id: '0',
        attempts: 5,
        successRate: 0.8,
        medianSuccessLatency: 1.1952,
        weightedSuccessLatency: 2.5,
        failure: true,
      },
      {
        id: '7',
        attempts: 1,
        successRate: 0.9,
        medianSuccessLatency: 0.52,
        weightedSuccessLatency: 1,
        failure: false,
      },
      {
        id: '2',
        attempts: 5,
        successRate: 0.9,
        medianSuccessLatency: 1.1562,
        weightedSuccessLatency: 2,
        failure: false,
      },
      {
        id: '6',
        attempts: 1,
        successRate: 0.9,
        medianSuccessLatency: 0.8212,
        weightedSuccessLatency: 1.5,
        failure: false,
      },
      {
        id: '4',
        attempts: 5,
        successRate: 0.8,
        medianSuccessLatency: 2.2152,
        weightedSuccessLatency: 3,
        failure: true,
      },
    ]

    const expectedSortedLogs = [
      {
        id: '7',
        attempts: 1,
        successRate: 0.9,
        medianSuccessLatency: 0.52,
        weightedSuccessLatency: 1,
        failure: false,
      },
      {
        id: '6',
        attempts: 1,
        successRate: 0.9,
        medianSuccessLatency: 0.8212,
        weightedSuccessLatency: 1.5,
        failure: false,
      },
      {
        id: '2',
        attempts: 5,
        successRate: 0.9,
        medianSuccessLatency: 1.1562,
        weightedSuccessLatency: 2,
        failure: false,
      },
      {
        id: '0',
        attempts: 5,
        successRate: 0.8,
        medianSuccessLatency: 1.1952,
        weightedSuccessLatency: 2.5,
        failure: true,
      },
      {
        id: '4',
        attempts: 5,
        successRate: 0.8,
        medianSuccessLatency: 2.2152,
        weightedSuccessLatency: 3,
        failure: true,
      },
    ]
    const sortedLogs = cherryPicker.sortLogs(unsortedLogs, '1234', '1234', '1234')

    expect(sortedLogs).to.be.deepEqual(expectedSortedLogs)
  })

  it('rank items based on successRates', async () => {
    const blockchain = '0027'
    // Each item represents a possible path for it based on their values
    const itemsToRank = [
      {
        id: '1000',
        attempts: 1,
        successRate: 0.99,
        medianSuccessLatency: 0.52,
        weightedSuccessLatency: 1.43452,
        failure: false,
      },
      {
        id: '2000',
        attempts: 3,
        successRate: 0.96,
        medianSuccessLatency: 0.8212,
        weightedSuccessLatency: 2.1963,
        failure: false,
      },
      {
        id: '3000',
        attempts: 5,
        successRate: 0.7,
        medianSuccessLatency: 1.1562,
        weightedSuccessLatency: 3.54721,
        failure: false,
      },
      {
        id: '4000',
        attempts: 2,
        successRate: 0,
        medianSuccessLatency: 1.1952,
        weightedSuccessLatency: 4.6789,
        failure: false,
      },
      {
        id: '5000',
        attempts: 6,
        successRate: 0,
        medianSuccessLatency: 2.2152,
        weightedSuccessLatency: 6.7865,
        failure: false,
      },
    ]
    const failureItem = itemsToRank[itemsToRank.length - 1]
    const rankedItems = await cherryPicker.rankItems(blockchain, itemsToRank, 5)

    expect(rankedItems).to.be.Array()

    const rankedItemsCount = rankedItems.reduce((items, id) => {
      items[id] = items[id] !== undefined ? ++items[id] : 1
      return items
    }, {})

    // Take advantage of lexicography ordering of strings
    const sortedKeys = Object.keys(rankedItemsCount).sort()

    // Each sorted key should be higher or equal than the next, hence the higher rank
    for (let i = 0; i < sortedKeys.length - 1; i++) {
      const currentItem = rankedItemsCount[sortedKeys[i]]
      const nextItem = rankedItemsCount[sortedKeys[i + 1]]

      expect(currentItem).to.be.aboveOrEqual(nextItem)
    }

    // Last item with id '5000' cannot be on the list as is attempts are
    // above the threshold
    expect(sortedKeys).to.have.length(4)
    expect(sortedKeys).to.not.containDeep([failureItem.id])

    // Failure node should be set as that on redis
    const isFailureNodeCached = await redis.get(blockchain + '-' + failureItem.id + '-failure')

    expect(isFailureNodeCached).to.be.equal('true')
  })
})
