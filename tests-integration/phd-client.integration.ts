import { expect } from '@loopback/testlab'

import { GatewayDataSource } from '../src/datasources'
import { Applications, Blockchains, LoadBalancers } from '../src/models'
import { ApplicationsRepository, BlockchainsRepository, LoadBalancersRepository } from '../src/repositories'
import { PHDClient } from '../src/services/phd-client'

import 'dotenv/config'

describe('Pocket HTTP DB Client', () => {
  let phdClient: PHDClient
  let blockchainsRepository: BlockchainsRepository
  let applicationsRepository: ApplicationsRepository
  let loadBalancersRepository: LoadBalancersRepository

  before('setupApplication', async () => {
    const datasource = new GatewayDataSource()
    phdClient = new PHDClient()
    blockchainsRepository = new BlockchainsRepository(datasource)
    applicationsRepository = new ApplicationsRepository(datasource)
    loadBalancersRepository = new LoadBalancersRepository(datasource)
  })

  describe('find', () => {
    describe('blockchains', () => {
      it('fetches blockchains from PHD', async () => {
        const blockchains = await phdClient.find<Blockchains>({
          path: 'blockchain',
          model: Blockchains,
          fallback: () => blockchainsRepository.find(),
        })

        expect(blockchains.length).to.be.aboveOrEqual(1)
        blockchains.forEach((chain) => {
          expect(chain).to.have.properties(
            'id',
            'ticker',
            'network',
            'index',
            'blockchain',
            'blockchainAliases',
            'active',
            'path'
          )
        })
      })

      it('fetches blockchains from MongoDB if PHD fetch fails', async () => {
        const blockchains = await phdClient.find<Blockchains>({
          path: 'not_blockchain',
          model: Blockchains,
          fallback: () => blockchainsRepository.find(),
        })

        expect(blockchains.length).to.be.aboveOrEqual(1)
        blockchains.forEach((chain) => {
          expect(chain).to.have.properties(
            'id',
            'ticker',
            'network',
            'index',
            'blockchain',
            'blockchainAliases',
            'active',
            'path'
          )
        })
      })
    })
  })

  describe('findById', () => {
    describe('blockchain', () => {
      it('fetches a blockchain from PHD', async () => {
        const testId = '0001'

        const blockchain = await phdClient.findById<Blockchains>({
          path: 'blockchain',
          id: testId,
          model: Blockchains,
          fallback: () => blockchainsRepository.findById(testId),
        })

        expect(blockchain).not.to.be.undefined()
        expect(blockchain.ticker).to.equal('POKT')
        expect(blockchain).to.have.properties(
          'id',
          'ticker',
          'network',
          'index',
          'blockchain',
          'blockchainAliases',
          'active',
          'path'
        )
      })

      it('fetches a blockchain from MongoDB if PHD fetch fails', async () => {
        const testId = '0001'

        const blockchain = await phdClient.findById<Blockchains>({
          path: 'blockchain',
          id: 'not-pokt-id',
          model: Blockchains,
          fallback: () => blockchainsRepository.findById(testId),
        })

        expect(blockchain).not.to.be.undefined()
        expect(blockchain.ticker).to.equal('POKT')
        expect(blockchain).to.have.properties(
          'id',
          'ticker',
          'network',
          'index',
          'blockchain',
          'blockchainAliases',
          'active',
          'path'
        )
      })
    })

    describe('load_balancer', () => {
      it('fetches a load balancer from PHD', async () => {
        const testId = '6307c50471e59c00380027cb'

        const loadBalancer = await phdClient.findById<LoadBalancers>({
          path: 'load_balancer',
          id: testId,
          model: LoadBalancers,
          fallback: () => loadBalancersRepository.findById(testId),
        })

        expect(loadBalancer).not.to.be.undefined()
        expect(loadBalancer.name).to.equal('PascalsTestApp')
        expect(loadBalancer).to.have.properties('gigastakeRedirect', 'userID', 'applicationIDs')
      })

      it('fetches a load balancer from MongoDB if PHD fetch fails', async () => {
        const testId = '6307c50471e59c00380027cb'

        const loadBalancer = await phdClient.findById<LoadBalancers>({
          path: 'load_balancer',
          id: 'not-an-lb-id',
          model: LoadBalancers,
          fallback: () => loadBalancersRepository.findById(testId),
        })

        expect(loadBalancer).not.to.be.undefined()
        expect(loadBalancer.name).to.equal('PascalsTestApp')
        expect(loadBalancer).to.have.properties('gigastakeRedirect', 'userID', 'applicationIDs')
      })
    })

    describe('application', () => {
      it('fetches an application from PHD', async () => {
        const testId = '6307c50471e59c00380027c9'

        const application = await phdClient.findById<Applications>({
          path: 'application',
          id: testId,
          model: Applications,
          fallback: () => applicationsRepository.findById(testId),
        })

        expect(application).not.to.be.undefined()
        expect(application.name).to.equal('PascalsTestApp')
        expect(application).to.have.properties('id', 'freeTier', 'gatewayAAT', 'gatewaySettings')
      })

      it('fetches an application from MongoDB if PHD fetch fails', async () => {
        const testId = '6307c50471e59c00380027c9'

        const application = await phdClient.findById<Applications>({
          path: 'application',
          id: 'not-an-app-id',
          model: Applications,
          fallback: () => applicationsRepository.findById(testId),
        })

        expect(application).not.to.be.undefined()
        expect(application.name).to.equal('PascalsTestApp')
        expect(application).to.have.properties('id', 'freeTier', 'gatewayAAT', 'gatewaySettings')
      })
    })
  })

  describe('count', () => {
    describe('blockchains', () => {
      it('fetches the count of blockchains from PHD', async () => {
        const { count } = await phdClient.count({
          path: 'blockchains',
          model: Blockchains,
          fallback: () => blockchainsRepository.count(),
        })

        expect(count).not.to.be.undefined()
        expect(count).to.be.aboveOrEqual(1)
      })

      it('fetches the count of blockchains from MongoDB if PHD fetch fails', async () => {
        const { count } = await phdClient.count({
          path: 'not_blockchains',
          model: Blockchains,
          fallback: () => blockchainsRepository.count(),
        })

        expect(count).not.to.be.undefined()
        expect(count).to.be.aboveOrEqual(1)
      })
    })
  })
})
