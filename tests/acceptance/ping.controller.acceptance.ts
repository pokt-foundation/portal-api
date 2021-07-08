import { Client, expect } from '@loopback/testlab'
import { PocketGatewayApplication } from '../..'
import { setupApplication } from './test-helper'

describe('PingController', () => {
  let app: PocketGatewayApplication
  let client: Client

  before('setupApplication', async () => {
    ;({ app, client } = await setupApplication())
  })

  after(async () => {
    await app.stop()
  })

  it('invokes GET /ping', async () => {
    const res = await client.get('/ping').expect(200)

    expect(res.body).to.have.property(
      'greeting',
      'Pocket Network Gateway is saying hello and welcome onboard!'
    )

    expect(res.body).to.have.property('url')

    expect(res.body).to.have.property('date')

    expect(res.body).to.have.property('headers')
  })
})
