import { CherryPicker } from '../../src/services/cherry-picker'
import RedisMock from 'ioredis-mock'
import { expect } from '@loopback/testlab'
import { Node } from '@pokt-network/pocket-js'
import { Applications } from '../../src/models'

describe('Cherry picker service (unit)', () => {
  let cherryPicker: CherryPicker
  let redis: RedisMock

  before('initialize instance', async () => {
    redis = new RedisMock(0, '')

    cherryPicker = new CherryPicker({ redis, checkDebug: true })
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
          averageSuccessLatency: '1.79778',
        }),
        'EX',
        120
      )
      await redis.set(
        blockchain + '-' + nodes[1].publicKey + '-service',
        JSON.stringify({
          results: { '200': 4 },
          averageSuccessLatency: '0.57491',
        }),
        'EX',
        120
      )
      await redis.set(
        blockchain + '-' + nodes[2].publicKey + '-service',
        JSON.stringify({
          results: { '500': 6 },
          averageSuccessLatency: '2.57491',
        }),
        'EX',
        120
      )
      await redis.set(blockchain + '-' + nodes[4].publicKey + '-failure', 'true', 'EX', 120)
      await redis.set(blockchain + '-' + nodes[0].publicKey + '-failure', 'true', 'EX', 120)

      // @ts-ignore
      const node = await cherryPicker.cherryPickNode(app, nodes, blockchain, '34sfDg')

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
            averageSuccessLatency: '1',
          }),
          'EX',
          120
        )
        await redis.set(blockchain + '-' + node.publicKey + '-failure', 'true', 'EX', 120)
      }

      // @ts-ignore
      const pickedNode = await cherryPicker.cherryPickNode(app, nodes, blockchain, '34sfDg')

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
        averageSuccessLatency: 0,
        failure: false,
      }

      const serviceLog = await cherryPicker.createUnsortedLog('fd4f41fe0f04a20226', '0027', '')

      expect(serviceLog).to.be.deepEqual(expectedServiceLog)
    })

    it('creates an unsorted log for an used node', async () => {
      const rawLog = '{"results":{"200":1},"averageSuccessLatency":"0.30820"}'

      const expectedServiceLog = {
        id: 'fd4f41fe0f04a20226',
        attempts: 1,
        successRate: 1,
        averageSuccessLatency: 0.3082,
        failure: false,
      }

      const serviceLog = await cherryPicker.createUnsortedLog('fd4f41fe0f04a20226', '0027', rawLog)

      expect(serviceLog).to.be.deepEqual(expectedServiceLog)
    })

    it('removes the failure status from a previously marked node', async () => {
      const rawLog = '{"results":{"200":1},"averageSuccessLatency":"0.30820"}'
      const id = 'fd4f41fe0f04a20226'
      const blockchain = '0027'
      let failureNode: string

      const expectedServiceLog = {
        id: 'fd4f41fe0f04a20226',
        attempts: 1,
        successRate: 1,
        averageSuccessLatency: 0.3082,
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
        averageSuccessLatency: '0.00000',
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
        averageSuccessLatency: '1.40417', // average after calculation from fn
        results: {
          '200': 2,
          '500': 2,
        },
      })

      await redis.set(
        blockchain + '-' + id + '-service',
        '{"results":{"200":1,"500":2},"averageSuccessLatency":"1.79778"}',
        'EX',
        60
      )

      await cherryPicker.updateServiceQuality(blockchain, 'appID', id, elapseTime, result)
      const logs = await redis.get(blockchain + '-' + id + '-service')

      expect(JSON.parse(logs)).to.be.deepEqual(JSON.parse(expectedLogs))
    })
  })

  it('should be defined', () => {
    expect(cherryPicker).to.be.ok()
  })

  it('sort logs based on success rate and average latency', () => {
    const unsortedLogs = [
      {
        id: '0',
        attempts: 5,
        successRate: 0.8,
        averageSuccessLatency: 2,
        failure: true,
      },
      {
        id: '7',
        attempts: 1,
        successRate: 0.9,
        averageSuccessLatency: 1,
        failure: false,
      },
      {
        id: '2',
        attempts: 5,
        successRate: 0.9,
        averageSuccessLatency: 3,
        failure: false,
      },
      {
        id: '6',
        attempts: 1,
        successRate: 0.9,
        averageSuccessLatency: 1,
        failure: false,
      },
      {
        id: '4',
        attempts: 5,
        successRate: 0.8,
        averageSuccessLatency: 3,
        failure: true,
      },
    ]

    const expectedSortedLogs = [
      {
        id: '7',
        attempts: 1,
        successRate: 0.9,
        averageSuccessLatency: 1,
        failure: false,
      },
      {
        id: '6',
        attempts: 1,
        successRate: 0.9,
        averageSuccessLatency: 1,
        failure: false,
      },
      {
        id: '2',
        attempts: 5,
        successRate: 0.9,
        averageSuccessLatency: 3,
        failure: false,
      },
      {
        id: '0',
        attempts: 5,
        successRate: 0.8,
        averageSuccessLatency: 2,
        failure: true,
      },
      {
        id: '4',
        attempts: 5,
        successRate: 0.8,
        averageSuccessLatency: 3,
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
        averageSuccessLatency: 1.43452,
        failure: false,
      },
      {
        id: '2000',
        attempts: 3,
        successRate: 0.96,
        averageSuccessLatency: 2.1963,
        failure: false,
      },
      {
        id: '3000',
        attempts: 5,
        successRate: 0.7,
        averageSuccessLatency: 3.54721,
        failure: false,
      },
      {
        id: '4000',
        attempts: 2,
        successRate: 0,
        averageSuccessLatency: 4.6789,
        failure: false,
      },
      {
        id: '5000',
        attempts: 6,
        successRate: 0,
        averageSuccessLatency: 6.7865,
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

  describe('cherryPickApplication function', () => {
    it('picks an application', async () => {
      const appsIDs = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
      const lbID = 'df89cxDaLoLROFLMAO'
      const blockchain = '0027'

      // Simulate several apps cached
      await redis.set(
        blockchain + '-' + appsIDs[0] + '-service',
        JSON.stringify({
          results: { '200': 1, '500': 2 },
          averageSuccessLatency: '1.79778',
        }),
        'EX',
        120
      )
      await redis.set(
        blockchain + '-' + appsIDs[1] + '-service',
        JSON.stringify({
          results: { '200': 2, '500': 1 },
          averageSuccessLatency: '0.57491',
        }),
        'EX',
        120
      )
      await redis.set(
        blockchain + '-' + appsIDs[2] + '-service',
        JSON.stringify({
          results: { '200': 1 },
          averageSuccessLatency: '1.57491',
        }),
        'EX',
        120
      )
      await redis.set(
        blockchain + '-' + appsIDs[3] + '-service',
        JSON.stringify({
          results: { '500': 20 },
          averageSuccessLatency: '1.57491',
        }),
        'EX',
        120
      )

      const pickedApp = await cherryPicker.cherryPickApplication(lbID, appsIDs, blockchain, 'asfC9d')

      expect(pickedApp).to.be.ok()
      expect(pickedApp).to.be.String()

      console.log(pickedApp)

      // App should continue flagged as failure
      const failureNode = await redis.get(blockchain + '-' + appsIDs[3] + '-failure')

      expect(failureNode).to.be.equal('true')
    })

    it('picks an application when all of them are failures', async () => {
      const appsIDs = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
      const lbID = 'df89cxDaLoLROFLMAO'
      const blockchain = '0027'

      for (const app of appsIDs) {
        await redis.set(
          blockchain + '-' + app + '-service',
          JSON.stringify({
            results: { '500': 20 },
            averageSuccessLatency: '1',
          }),
          'EX',
          120
        )
        await redis.set(blockchain + '-' + app + '-failure', 'true', 'EX', 120)
      }
      const pickedApp = await cherryPicker.cherryPickApplication(lbID, appsIDs, blockchain, 'asfC9d')

      expect(pickedApp).to.be.ok()
      expect(pickedApp).to.be.String()

      console.log(pickedApp)

      // All apps should continue being failures
      for (const app of appsIDs) {
        const failureApp = await redis.get(blockchain + '-' + app + '-failure')

        expect(failureApp).to.be.equal('true')
      }
    })
  })
})
