import * as dotenv from 'dotenv'
import { expect, sinon } from '@loopback/testlab'

import { GatewayDataSource } from '../../src/datasources'
import { Applications, Blockchains, LoadBalancers } from '../../src/models'
import { ApplicationsRepository, BlockchainsRepository, LoadBalancersRepository } from '../../src/repositories'
import { PHDClient, PHDPaths } from '../../src/services/phd-client'

const logger = require('../../src/services/logger')

const blockchainRequiredFields = [
  'id',
  'ticker',
  'chainID',
  'chainIDCheck',
  'enforceResult',
  'network',
  'blockchain',
  'blockchainAliases',
  'active',
  'syncCheckOptions',
  'logLimitBlocks',
  'path',
  'altruist',
]
const loadBalancerRequiredFields = ['user', 'requestTimeout', 'applicationIDs']
const applicationRequiredFields = ['id', 'freeTierApplicationAccount', 'gatewayAAT', 'gatewaySettings']

const integrationDescribe = process.env.INTEGRATION_TEST === 'true' ? describe : describe.skip
integrationDescribe('Pocket HTTP DB Client', () => {
  let phdClient: PHDClient

  let blockchainsRepository: BlockchainsRepository
  let applicationsRepository: ApplicationsRepository
  let loadBalancersRepository: LoadBalancersRepository

  let logSpy: sinon.SinonSpy

  before('setup', async () => {
    dotenv.config()
    phdClient = new PHDClient(process.env.PHD_BASE_URL, process.env.PHD_API_KEY)
    const datasource = new GatewayDataSource()
    blockchainsRepository = new BlockchainsRepository(datasource)
    applicationsRepository = new ApplicationsRepository(datasource)
    loadBalancersRepository = new LoadBalancersRepository(datasource)
  })

  after('cleanup', async () => {
    process.env.MONGO_ENDPOINT = 'test'
    process.env.INTEGRATION_TEST = 'false'
  })

  beforeEach(() => {
    logSpy = sinon.spy(logger, 'log')
  })
  afterEach(() => logSpy.restore())

  describe('find', () => {
    describe('blockchains', () => {
      it('fetches blockchains from PHD', async () => {
        const blockchains = await phdClient.find<Blockchains>({
          path: PHDPaths.Blockchain,
          model: Blockchains,
          fallback: () => undefined,
        })

        expect(logSpy.calledOnceWith('warn')).to.be.false()
        expect(blockchains.length).to.be.above(1)
        blockchains.forEach((chain) => {
          expect(chain).to.have.properties(blockchainRequiredFields)
        })
      })

      it('fetches blockchains from MongoDB if PHD fetch fails', async () => {
        const blockchains = await phdClient.find<Blockchains>({
          path: 'not_blockchain',
          model: Blockchains,
          fallback: () => blockchainsRepository.find(),
        })

        expect(logSpy.calledOnceWith('warn')).to.be.true()
        expect(blockchains.length).to.be.above(1)
        blockchains.forEach((chain) => {
          expect(chain).to.have.properties(blockchainRequiredFields)
        })
      })
    })
  })

  describe('findById', () => {
    describe('blockchain', () => {
      it('fetches a blockchain from PHD', async () => {
        const testId = '0001'

        const blockchain = await phdClient.findById<Blockchains>({
          path: PHDPaths.Blockchain,
          id: testId,
          model: Blockchains,
          fallback: () => undefined,
        })

        expect(logSpy.calledOnceWith('warn')).to.be.false()
        expect(blockchain).not.to.be.undefined()
        expect(blockchain.ticker).to.equal('POKT')
        expect(blockchain).to.have.properties(blockchainRequiredFields)
      })

      it('fetches a blockchain from MongoDB if PHD fetch fails', async () => {
        const testId = '0001'

        const blockchain = await phdClient.findById<Blockchains>({
          path: PHDPaths.Blockchain,
          id: 'not-pokt-id',
          model: Blockchains,
          fallback: () => blockchainsRepository.findById(testId),
        })

        expect(logSpy.calledOnceWith('warn')).to.be.true()
        expect(blockchain).not.to.be.undefined()
        expect(blockchain.ticker).to.equal('POKT')
        expect(blockchain).to.have.properties(blockchainRequiredFields)
      })
    })

    describe('load_balancer', () => {
      it('fetches a load balancer from PHD', async () => {
        const testId = '6307c50471e59c00380027cb'

        const loadBalancer = await phdClient.findById<LoadBalancers>({
          path: PHDPaths.LoadBalancer,
          id: testId,
          model: LoadBalancers,
          fallback: () => undefined,
        })

        expect(logSpy.calledOnceWith('warn')).to.be.false()
        expect(loadBalancer).not.to.be.undefined()
        expect(loadBalancer.name).to.equal('PascalsTestApp')
        expect(loadBalancer).to.have.properties(loadBalancerRequiredFields)
      })

      it('fetches a load balancer from MongoDB if PHD fetch fails', async () => {
        const testId = '6307c50471e59c00380027cb'

        const loadBalancer = await phdClient.findById<LoadBalancers>({
          path: PHDPaths.LoadBalancer,
          id: 'not-an-lb-id',
          model: LoadBalancers,
          fallback: () => loadBalancersRepository.findById(testId),
        })

        expect(logSpy.calledOnceWith('warn')).to.be.true()
        expect(loadBalancer).not.to.be.undefined()
        expect(loadBalancer.name).to.equal('PascalsTestApp')
        expect(loadBalancer).to.have.properties(loadBalancerRequiredFields)
      })
    })

    describe('application', () => {
      it('fetches an application from PHD', async () => {
        const testId = '6307c50471e59c00380027c9'

        const application = await phdClient.findById<Applications>({
          path: PHDPaths.Application,
          id: testId,
          model: Applications,
          fallback: () => undefined,
        })

        expect(logSpy.calledOnceWith('warn')).to.be.false()
        expect(application).not.to.be.undefined()
        expect(application.name).to.equal('PascalsTestApp')
        expect(application).to.have.properties(applicationRequiredFields)
      })

      it('fetches an application from MongoDB if PHD fetch fails', async () => {
        const testId = '6307c50471e59c00380027c9'

        const application = await phdClient.findById<Applications>({
          path: PHDPaths.Application,
          id: 'not-an-app-id',
          model: Applications,
          fallback: () => applicationsRepository.findById(testId),
        })

        expect(logSpy.calledOnceWith('warn')).to.be.true()
        expect(application).not.to.be.undefined()
        expect(application.name).to.equal('PascalsTestApp')
        expect(application).to.have.properties(applicationRequiredFields)
      })
    })
  })

  describe('count', () => {
    describe('blockchains', () => {
      it('fetches the count of blockchains from PHD', async () => {
        const { count } = await phdClient.count({
          path: PHDPaths.Blockchain,
          model: Blockchains,
          fallback: () => undefined,
        })

        expect(logSpy.calledOnceWith('warn')).to.be.false()
        expect(count).not.to.be.undefined()
        expect(count).to.be.above(1)
      })

      it('fetches the count of blockchains from MongoDB if PHD fetch fails', async () => {
        const { count } = await phdClient.count({
          path: 'not_blockchain',
          model: Blockchains,
          fallback: () => blockchainsRepository.count(),
        })

        expect(logSpy.calledOnceWith('warn')).to.be.true()
        expect(count).not.to.be.undefined()
        expect(count).to.be.above(1)
      })
    })
  })
})
