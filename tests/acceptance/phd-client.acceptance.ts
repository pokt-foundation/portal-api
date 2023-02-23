import * as dotenv from 'dotenv'
import { expect, sinon } from '@loopback/testlab'

import { Applications, Blockchains, LoadBalancers } from '../../src/models'
import { PHDClient, PHDPaths } from '../../src/services/phd-client'

const logger = require('../../src/services/logger')

const integrationDescribe = process.env.INTEGRATION_TEST === 'true' ? describe : describe.skip
integrationDescribe('Pocket HTTP DB Client', () => {
  let phdClient: PHDClient

  let logSpy: sinon.SinonSpy

  before('setup', async () => {
    dotenv.config()
    phdClient = new PHDClient(process.env.PHD_BASE_URL, process.env.PHD_API_KEY)
  })

  after('cleanup', async () => {
    process.env.INTEGRATION_TEST = 'false'
  })

  beforeEach(() => {
    logSpy = sinon.spy(logger, 'log')
  })
  afterEach(() => logSpy.restore())

  describe('find', () => {
    describe('blockchains', () => {
      it('fetches blockchains from PHD', async () => {
        const blockchains = await phdClient.find<Blockchains>({ path: PHDPaths.Blockchain })

        expect(logSpy.calledOnceWith('error')).to.be.false()
        expect(blockchains.length).to.be.above(1)
      })
    })
  })

  describe('findById', () => {
    describe('blockchain', () => {
      it('fetches a blockchain from PHD', async () => {
        const testId = '0001'

        const blockchain = await phdClient.findById<Blockchains>({ path: PHDPaths.Blockchain, id: testId })

        expect(logSpy.calledOnceWith('error')).to.be.false()
        expect(blockchain).not.to.be.undefined()
        expect(blockchain.ticker).to.equal('POKT')
      })
    })

    describe('load_balancer', () => {
      it('fetches a load balancer from PHD', async () => {
        const testId = '280023ecacf59129e9497bc2'

        const loadBalancer = await phdClient.findById<LoadBalancers>({ path: PHDPaths.LoadBalancer, id: testId })

        expect(logSpy.calledOnceWith('error')).to.be.false()
        expect(loadBalancer).not.to.be.undefined()
        expect(loadBalancer.name).to.equal('Pascals_test_app_DO-NOT-DELETE')
      })
    })

    describe('application', () => {
      it('fetches an application from PHD', async () => {
        const testId = '6307c50471e59c00380027c9'

        const application = await phdClient.findById<Applications>({ path: PHDPaths.Application, id: testId })

        expect(logSpy.calledOnceWith('error')).to.be.false()
        expect(application).not.to.be.undefined()
        expect(application.name).to.equal('PascalsTestApp')
      })
    })
  })

  describe('count', () => {
    describe('blockchains', () => {
      it('fetches the count of blockchains from PHD', async () => {
        const { count } = await phdClient.count({ path: PHDPaths.Blockchain })

        expect(logSpy.calledOnceWith('error')).to.be.false()
        expect(count).not.to.be.undefined()
        expect(count).to.be.above(1)
      })
    })
  })
})
