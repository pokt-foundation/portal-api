import { PocketGatewayApplication } from '../..'
import { Client, expect } from '@loopback/testlab'
import { setupApplication } from './test-helper'
import { gatewayTestDB } from '../fixtures/test.datasource'
import { BlockchainsRepository } from '../../src/repositories/blockchains.repository'
import { Blockchains } from '../../src/models/blockchains.model'

describe('Blockchain (acceptance)', () => {
  let app: PocketGatewayApplication
  let client: Client

  before('setupApplication', async () => {
    ;({ app, client } = await setupApplication())
  })

  after(async () => {
    await app.stop()
  })

  const cleanDB = async () => {
    await new BlockchainsRepository(gatewayTestDB).deleteAll()
  }

  afterEach(cleanDB)

  it('retrieves list of available blockchains', async () => {
    const expected = Object.assign(
      {},
      {
        _id: '0024',
        ticker: 'POA',
        networkID: '42',
        network: 'POA-42',
        description: 'Kovan',
        index: 6,
        blockchain: 'poa-kovan',
        active: true,
        enforceResult: 'JSON',
        nodeCount: 23,
        hash: '1234',
      }
    )

    await new BlockchainsRepository(gatewayTestDB).create(expected)

    const res = await client.get('/blockchains').expect(200)

    expect(res.body).to.be.Array()
    expect(res.body).to.have.length(1)
    expect(res.body[0]).to.containEql(expected)
  })

  it('retrieves the total count of blockchains', async () => {
    await generateBlockchains(5)

    const res = await client.get('/blockchains/count').expect(200)

    expect(res.body).to.be.Object()
    expect(res.body).to.have.property('count')
    expect(res.body.count).to.equal(5)
  })

  it('retrieves the information of an specific blockchain', async () => {
    const expected = Object.assign(
      {},
      {
        _id: '0024',
        ticker: 'POA',
        networkID: '42',
        network: 'POA-42',
        description: 'Kovan',
        index: 6,
        blockchain: 'poa-kovan',
        active: true,
        enforceResult: 'JSON',
        nodeCount: 23,
        hash: '1234',
      }
    )

    await new BlockchainsRepository(gatewayTestDB).create(expected)

    const res = await client.get('/blockchains/1234').expect(200)

    expect(res.body).to.be.Object()
    expect(res.body).to.containEql(expected)

    // Blockchain that doesn't exist
    await client.get('/blockchains/nope').expect(404)
  })

  async function generateBlockchains(amount: number): Promise<Partial<Blockchains>> {
    const blockchains = []

    for (let i = 0; i < amount; i++) {
      blockchains.push(
        Object.assign(
          {},
          {
            _id: `000${1}`,
            ticker: 'POA',
            networkID: '42',
            network: 'POA-42',
            description: 'Kovan',
            index: 6,
            blockchain: 'poa-kovan',
            active: true,
            enforceResult: 'JSON',
            nodeCount: 23,
            hash: i,
          }
        )
      )
    }

    const result = await new BlockchainsRepository(gatewayTestDB).createAll(blockchains)

    return result
  }
})
