import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { Client, expect, sinon } from '@loopback/testlab'
import { PocketGatewayApplication } from '../..'
import { Blockchains, blockchainToBlockchainResponse } from '../../src/models/blockchains.model'
import { DUMMY_ENV, setupApplication } from './test-helper'

const mockChain = Object.assign(
  {},
  {
    id: '0024',
    ticker: 'POA',
    chainID: '42',
    chainIDCheck: '{\\"method\\":\\"eth_chainId\\",\\"id\\":1,\\"jsonrpc\\":\\"2.0\\"}',
    enforceResult: 'JSON',
    networkID: '42',
    network: 'POA-42',
    description: 'Kovan',
    index: 6,
    blockchain: 'poa-kovan',
    blockchainAliases: ['poa-kovan', 'eth-kovan'],
    active: true,
    syncCheckOptions: {
      body: '',
      resultKey: '',
      path: '',
      allowance: 0,
    },
    logLimitBlocks: 100000,
    path: '',
    altruist: 'https://user:pass@test.example.org:12345',
    requestTimeout: 0,
    syncAllowance: 0,
    redirects: [],
    hash: '0',
    evm: false,
  }
)

function generateBlockchains(amount: number): Blockchains[] {
  const blockchains = []

  for (let i = 0; i < amount; i++) {
    const id = amount > 1 ? `${mockChain.id}${i + 1}` : mockChain.id
    blockchains.push({ ...mockChain, id })
  }

  return blockchains
}

describe('Blockchains controller (acceptance)', () => {
  let app: PocketGatewayApplication
  let client: Client
  let axiosMock: MockAdapter

  before('setupApplication', async () => {
    axiosMock = new MockAdapter(axios)
    axiosMock.onGet(DUMMY_ENV.PHD_BASE_URL).reply(200)
    ;({ app, client } = await setupApplication())
  })

  after(async () => {
    sinon.restore()
    await app.stop()
  })

  afterEach(async () => {
    axiosMock.reset()
  })

  describe('/blockchains/count endpoint', () => {
    it('retrieves the total count of blockchains', async () => {
      const blockchains = generateBlockchains(5)
      axiosMock.onGet(`${process.env.PHD_BASE_URL}/v1/blockchain`).replyOnce(200, blockchains)

      const res = await client.get('/blockchains/count').expect(200)

      expect(res.body).to.be.Object()
      expect(res.body).to.have.property('count')
      expect(res.body.count).to.equal(5)
    })
  })

  describe('/blockchains endpoint', () => {
    it('retrieves list of available blockchains', async () => {
      const blockchains = generateBlockchains(1)
      axiosMock.onGet(`${process.env.PHD_BASE_URL}/v1/blockchain`).replyOnce(200, blockchains)

      const res = await client.get('/blockchains').expect(200)

      expect(axiosMock.history.get.length).to.equal(1)
      expect(res.body).to.be.Array()
      expect(res.body).to.have.length(1)
      expect(res.body[0]).to.containEql(blockchainToBlockchainResponse(blockchains[0]))
    })
  })

  describe('/blockchains/{id} endpoint', () => {
    it('retrieves a specific blockchain', async () => {
      const [blockchain] = generateBlockchains(1)
      axiosMock.onGet(`${process.env.PHD_BASE_URL}/v1/blockchain/${blockchain.id}`).replyOnce(200, blockchain)

      const res = await client.get(`/blockchains/${blockchain.id}`).expect(200)

      expect(res.body).to.be.Object()
      expect(res.body).to.containEql(blockchainToBlockchainResponse(blockchain))
    })

    it('returns 404 on not found id', async () => {
      await client.get('/blockchains/invalid').expect(404)
    })
  })

  describe('/blockchains/ids endpoint', () => {
    it('retrieves a mapping of the available aliases for the chains', async () => {
      const blockchains = generateBlockchains(1)
      axiosMock.onGet(`${process.env.PHD_BASE_URL}/v1/blockchain`).replyOnce(200, blockchains)

      const res = await client.get('/blockchains/ids').expect(200)

      expect(res.body).to.be.Object()

      const blockchainID = 'Kovan'
      expect(res.body[blockchainID].prefix).to.be.Array()
      expect(res.body[blockchainID].prefix).to.have.length(2)

      expect(res.body[blockchainID].id).to.be.String()
      expect(res.body[blockchainID].id).to.be.equal('0024')
    })
  })
})
