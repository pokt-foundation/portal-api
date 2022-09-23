import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
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
  let axiosMock: MockAdapter

  before('setupApplication', async () => {
    ;({ app, client } = await setupApplication())
    axiosMock = new MockAdapter(axios)
    blockchainRepository = new BlockchainsRepository(gatewayTestDB)
  })

  after(async () => {
    sinon.restore()
    await app.stop()
  })

  const cleanDB = async () => {
    await blockchainRepository.deleteAll()
  }

  afterEach(async () => {
    await cleanDB()
    axiosMock.reset()
  })

  describe('/blockchains/count endpoint', () => {
    it('retrieves the total count of blockchains from the Pocket HTTP DB', async () => {
      await generateBlockchains(5)
      const res = await client.get('/blockchains/count').expect(200)
      axiosMock
        .onGet(`${process.env.PHD_BASE_URL}/blockchain`)
        .replyOnce(200, [mockChain, mockChain, mockChain, mockChain, mockChain])

      expect(res.body).to.be.Object()
      expect(res.body).to.have.property('count')
      expect(res.body.count).to.equal(5)
    })

    it('falls back to fetching the count from the repository if the PHD throws an error', async () => {
      await generateBlockchains(5)
      const res = await client.get('/blockchains/count').expect(200)
      axiosMock.onGet(`${process.env.PHD_BASE_URL}/blockchain`).replyOnce(500, null)

      expect(res.body).to.be.Object()
      expect(res.body).to.have.property('count')
      expect(res.body.count).to.equal(5)
    })
  })

  describe('/blockchains endpoint', () => {
    it('retrieves list of available blockchains from the Pocket HTTP DB', async () => {
      await blockchainRepository.create(mockChain)
      axiosMock.onGet(`${process.env.PHD_BASE_URL}/blockchain`).replyOnce(200, [mockChain])

      const res = await client.get('/blockchains').expect(200)

      expect(axiosMock.history.get.length).to.equal(1)
      expect(res.body).to.be.Array()
      expect(res.body).to.have.length(1)
      expect(res.body[0]).to.containEql(mockChain)
    })

    it('falls back to the fetching data from the repository if the PHD throws an error', async () => {
      await blockchainRepository.create(mockChain)
      axiosMock.onGet(`${process.env.PHD_BASE_URL}/blockchain`).replyOnce(500, null)

      const res = await client.get('/blockchains').expect(200)

      expect(axiosMock.history.get.length).to.equal(1)
      expect(res.body).to.be.Array()
      expect(res.body).to.have.length(1)
      expect(res.body[0]).to.containEql(mockChain)
    })

    it('falls back to the fetching data from the repository if the PHD data is missing required fields', async () => {
      await blockchainRepository.create(mockChain)
      const mockChainCopy = { ...mockChain }
      delete mockChainCopy.blockchain
      axiosMock.onGet(`${process.env.PHD_BASE_URL}/blockchain`).replyOnce(200, [mockChainCopy])

      const res = await client.get('/blockchains').expect(200)

      expect(axiosMock.history.get.length).to.equal(1)
      expect(res.body).to.be.Array()
      expect(res.body).to.have.length(1)
      expect(res.body[0]).to.containEql(mockChain)
    })
  })

  describe('/blockchains/{id} endpoint', () => {
    it('retrieves the a specific blockchain from the Pocket HTTP DB', async () => {
      const [blockchain] = await generateBlockchains(1)
      axiosMock.onGet(`${process.env.PHD_BASE_URL}/blockchain/${blockchain.id}`).replyOnce(200, mockChain)

      const res = await client.get(`/blockchains/${blockchain.id}`).expect(200)

      expect(res.body).to.be.Object()
      expect(res.body).to.containEql(blockchain)

      // Blockchain that doesn't exist
      await client.get('/blockchains/nope').expect(404)
    })

    it('falls back to the fetching a specific blockchain from the repository if the PHD throws an error', async () => {
      const [blockchain] = await generateBlockchains(1)
      axiosMock.onGet(`${process.env.PHD_BASE_URL}/blockchain/${blockchain.id}`).replyOnce(500, null)

      const res = await client.get(`/blockchains/${blockchain.id}`).expect(200)

      expect(res.body).to.be.Object()
      expect(res.body).to.containEql(blockchain)

      // Blockchain that doesn't exist
      await client.get('/blockchains/nope').expect(404)
    })
  })

  describe('/blockchains/ids endpoint', () => {
    it('retrieves a mapping of the available aliases for the chains from the Pocket HTTP DB', async () => {
      await generateBlockchains(1)
      axiosMock.onGet(`${process.env.PHD_BASE_URL}/blockchain`).replyOnce(200, [mockChain])

      const res = await client.get('/blockchains/ids').expect(200)

      expect(res.body).to.be.Object()

      const blockchainID = 'Kovan'
      expect(res.body[blockchainID].prefix).to.be.Array()
      expect(res.body[blockchainID].prefix).to.have.length(2)

      expect(res.body[blockchainID].id).to.be.String()
      expect(res.body[blockchainID].id).to.be.equal('0024')
    })

    it('falls back to the fetching a mapping of the available aliases for the chains from the repository if the PHD throws an error', async () => {
      await generateBlockchains(1)
      axiosMock.onGet(`${process.env.PHD_BASE_URL}/blockchain`).replyOnce(200, [mockChain])

      const res = await client.get('/blockchains/ids').expect(200)

      expect(res.body).to.be.Object()

      const blockchainID = 'Kovan'
      expect(res.body[blockchainID].prefix).to.be.Array()
      expect(res.body[blockchainID].prefix).to.have.length(2)

      expect(res.body[blockchainID].id).to.be.String()
      expect(res.body[blockchainID].id).to.be.equal('0024')
    })
  })

  async function generateBlockchains(amount: number): Promise<Partial<Blockchains>[]> {
    const blockchains = []

    for (let i = 0; i < amount; i++) {
      const id = amount > 1 ? `${mockChain.id}${i + 1}` : mockChain.id
      blockchains.push({ ...mockChain, id })
    }

    const result = blockchainRepository.createAll(blockchains)

    return result
  }
})

const mockChain = Object.assign(
  {},
  {
    id: '0024',
    altruist: 'https://user:pass@test.example.org:12345',
    blockchain: 'poa-kovan',
    chainID: '42',
    chainIDCheck: '{\\"method\\":\\"eth_chainId\\",\\"id\\":1,\\"jsonrpc\\":\\"2.0\\"}',
    description: 'Kovan',
    enforceResult: 'JSON',
    network: 'POA-42',
    networkID: '42',
    path: '',
    syncCheck: '',
    ticker: 'POA',
    blockchainAliases: ['poa-kovan', 'eth-kovan'],
    requestTimeout: 0,
    index: 6,
    logLimitBlocks: 100000,
    syncAllowance: 0,
    active: false,
    redirects: null,
    syncCheckOptions: {
      body: '',
      resultKey: '',
      path: '',
      allowance: 0,
    },
  }
)
