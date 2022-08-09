import { Client, expect, sinon } from '@loopback/testlab'
import { PocketGatewayApplication } from '../..'
import { Blockchains } from '../../src/models/blockchains.model'
import { BlockchainsRepository } from '../../src/repositories/blockchains.repository'
import { gatewayTestDB } from '../fixtures/test.datasource'
import { setupApplication } from './test-helper'

describe('Blockchains controller (acceptance)', () => {
  let app: PocketGatewayApplication
  let client: Client
  let blockchainRepository: BlockchainsRepository

  before('setupApplication', async () => {
    ;({ app, client } = await setupApplication())
    blockchainRepository = new BlockchainsRepository(gatewayTestDB)
  })

  after(async () => {
    sinon.restore()
    await app.stop()
  })

  const cleanDB = async () => {
    await blockchainRepository.deleteAll()
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
        blockchainAliases: ['poa-kovan'],
        active: true,
        evm: true,
        enforceResult: 'JSON',
        nodeCount: 23,
        hash: '1234',
        syncCheck: '',
        syncCheckOptions: {
          body: '{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}',
          resultKey: 'result',
          allowance: 2,
        },
        logLimitBlocks: 10,
        altruist: 'https://user:pass@backups.example.org:18546',
        redirects: [
          {
            alias: '',
            domain: '',
            loadBalancerID: '',
          },
        ],
      }
    )

    await blockchainRepository.create(expected)
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

  it('retrieves the information of a specific blockchain', async () => {
    const [blockchain] = await generateBlockchains(1)
    const res = await client.get(`/blockchains/${blockchain.hash}`).expect(200)

    expect(res.body).to.be.Object()
    expect(res.body).to.containEql(blockchain)

    // Blockchain that doesn't exist
    await client.get('/blockchains/nope').expect(404)
  })

  it('generate a mapping of the available aliases for the chains', async () => {
    await generateBlockchains(1)

    const res = await client.get('/blockchains/ids').expect(200)

    expect(res.body).to.be.Object()

    const blockchainID = 'Kovan'
    expect(res.body[blockchainID].prefix).to.be.Array()
    expect(res.body[blockchainID].prefix).to.have.length(1)

    expect(res.body[blockchainID].id).to.be.String()
    expect(res.body[blockchainID].id).to.be.equal('0')
  })

  async function generateBlockchains(amount: number): Promise<Partial<Blockchains>[]> {
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
            blockchainAliases: ['poa-kovan'],
            active: true,
            evm: true,
            enforceResult: 'JSON',
            nodeCount: 23,
            hash: i,
            syncCheck: '',
            syncCheckOptions: {
              body: '{"method":"eth_blockNumber","id":1,"jsonrpc":"2.0"}',
              resultKey: 'result',
              allowance: 2,
            },
            logLimitBlocks: 10,
            altruist: 'https://user:pass@backups.example.org:18546',
            redirects: [
              {
                alias: '',
                domain: '',
                loadBalancerID: '',
              },
            ],
          }
        )
      )
    }

    const result = blockchainRepository.createAll(blockchains)

    return result
  }
})
