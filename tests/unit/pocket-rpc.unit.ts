import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { sinon, expect } from '@loopback/testlab'
import { Session } from '@pokt-network/pocket-js'
import { PocketRPC } from '../../src/services/pocket-rpc'
import { DUMMY_ENV } from '../acceptance/test-helper'
import { DEFAULT_NODES } from '../mocks/pocketjs'

const DISPATCHERS = DUMMY_ENV.DISPATCH_URL.split(',').map((dispatcher) => new URL(dispatcher))

describe('Pocket RPC (unit)', () => {
  let axiosMock: MockAdapter

  before('setup', async () => {
    axiosMock = new MockAdapter(axios)
    axiosMock.onPost(`${DUMMY_ENV.DISPATCH_URL}v1/client/dispatch`).reply(200, {
      block_height: 1,
      session: {
        header: {
          app_public_key: '1234567890',
          chain: '0001',
          session_height: 1,
        },
        key: '1234567890',
        nodes: DEFAULT_NODES.map(
          ({
            address,
            chains,
            jailed,
            publicKey: public_key,
            serviceURL: service_url,
            status,
            stakedTokens: tokens,
            unstakingCompletionTimestamp: unstaking_time,
          }) => ({
            address,
            chains,
            jailed,
            public_key,
            service_url,
            status,
            tokens: tokens.toString(),
            unstaking_time,
          })
        ),
      },
    })
  })

  afterEach(async () => {
    sinon.restore()
  })

  after(async () => {
    axiosMock.restore()
  })

  it('successfully request a new session', async () => {
    const pocketRPC = new PocketRPC(DISPATCHERS)

    const session = await pocketRPC.dispatchNewSession({ appPublicKey: '000', blockchainID: '0021' })

    expect(session).to.be.instanceOf(Session)
    expect(session.sessionNodes).to.have.length(DEFAULT_NODES.length)
  })
})
