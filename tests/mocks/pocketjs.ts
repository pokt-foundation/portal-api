/* eslint-disable no-prototype-builtins */
import { URL } from 'url'
import { JsonRpcProvider } from '@pokt-foundation/pocketjs-provider'
import { PocketCoreError, Relayer } from '@pokt-foundation/pocketjs-relayer'
import { Session, SessionHeader, Node, StakingStatus } from '@pokt-foundation/pocketjs-types'
import { Mock, It } from 'moq.ts'
import { RelayResponse } from '../../src/utils/types'

export const DEFAULT_NODES: Node[] = [
  {
    address: '4decdda1c176daf9d70f482e1d7ac476eb57b7ae',
    publicKey: '3babba8b6a4a3d94e6a3d01d9e1ac15f8d5331f605b06421e5be1720d5a56867',
    jailed: false,
    chains: ['0001', '0027', '0021', '0040'],
    stakedTokens: '15145000000',
    status: StakingStatus.Staked,
    serviceUrl: 'https://validator0.org/',
    unstakingTime: '',
  },
  {
    address: '4ebc3a58b2c3e6ea59762f7d9f502e97a6901bac',
    publicKey: '61393a9f1cc7f97cbd8925c6a4337acdb4de6e869ed427b040ad19c04decb30b',
    jailed: false,
    status: StakingStatus.Staked,
    stakedTokens: '15145000000',
    serviceUrl: 'https://validator1.org/',
    chains: ['0009', '0027', '0012', '0010', '0040'],
    unstakingTime: '',
  },
  {
    address: 'b8c70edb826a33d15876d0926ab08d98d6f0bb23',
    publicKey: '2b0912cf2aae7c59cf792ecf5574e42cbeb5c4161b40c783df7ed1683a36fc69',
    jailed: false,
    status: StakingStatus.Staked,
    stakedTokens: '15150000000',
    serviceUrl: 'https://validator2.org/',
    chains: ['0008', '0015', '0020', '0018', '0040'],
    unstakingTime: '',
  },
  {
    address: '1bf7e0bda6e0e3deea77a5044d11840e73b39e63',
    publicKey: 'c431461fbd65044643902d430670a6ccc30dbf81b027f66a864cca701a653822',
    jailed: false,
    status: StakingStatus.Staked,
    stakedTokens: '15373984626',
    serviceUrl: 'https://validator3.org/',
    chains: ['0012', '0021', '0022', '0015', '0040'],
    unstakingTime: '',
  },
  {
    address: 'fb519210c9c0c531a5e73b2c114c5ff8354b301c',
    publicKey: '198fe21570be39cb7fd33928cf9f2699cb20b43ef704e4cc52045ace48799b19',
    jailed: false,
    status: StakingStatus.Staked,
    stakedTokens: '15369984630',
    serviceUrl: 'https://validator4.org/',
    chains: ['0027', '0002', '0004', '0022', '0040'],
    unstakingTime: '',
  },
]

// Default values to use for request/response objects
const DEFAULT_MOCK_VALUES = {
  DISPATCHERS: [
    new URL('https://node1.dispatcher.pokt.network'),
    new URL('https://node2.dispatcher.pokt.network'),
    new URL('https://node3.dispatcher.pokt.network'),
    new URL('https://node4.dispatcher.pokt.network'),
    new URL('https://node5.dispatcher.pokt.network'),
    new URL('https://node6.dispatcher.pokt.network'),
    new URL('https://node7.dispatcher.pokt.network'),
    new URL('https://node8.dispatcher.pokt.network'),
    new URL('https://node9.dispatcher.pokt.network'),
  ],
  NODES: DEFAULT_NODES,
  SESSION: {
    blockHeight: 100,
    header: {
      applicationPubKey: '2wqrn3ucg70wnqr278pnaxe1xnzgttcx9feg0cnl52w3jj5m7uw5ts3znvx0y93i',
      chain: '0001',
      sessionBlockHeight: 98,
    } as SessionHeader,
    key: 'default-session-key',
    nodes: DEFAULT_NODES,
  } as Session,
}

export type MockRelayResponse = string | RelayResponse | Error

const rpcMockError = new PocketCoreError(500, 'Mock error')

export class PocketMock {
  dispatchers: URL[]
  rpcProvider: JsonRpcProvider
  nodes: Node[]
  fail = false
  relayResponse: Record<string, MockRelayResponse | Array<MockRelayResponse>> = {
    '{"method":"eth_blockNumber","params":[],"id":1,"jsonrpc":"2.0"}': '{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}',
  }
  relayCounter: Record<string, number>
  session: Session

  constructor(dispatchers?: URL[], rpcProvider?: JsonRpcProvider, session?: Session) {
    // Cannot set rpcProvider without setting the dispatchers as it depends on them
    if (rpcProvider && !dispatchers) {
      throw new Error('Cannot set rpcProvider without dispatchers')
    }

    this.dispatchers = dispatchers || DEFAULT_MOCK_VALUES.DISPATCHERS
    this.rpcProvider =
      rpcProvider ||
      new JsonRpcProvider({
        rpcUrl: this.dispatchers[0].toString(),
        dispatchers: this.dispatchers.map((dist) => dist.toString()),
      })
    this.session = session || DEFAULT_MOCK_VALUES.SESSION

    this.relayCounter = {}
  }

  /**
   * Retrieves an object instance of pocketjs  with the configured options
   * @returns pocketjs instance with mocked functions
   */
  object(): Relayer {
    const repoMock = new Mock<Relayer>()
      .setup((instance) => instance.getNewSession(It.IsAny()))
      .returnsAsync(this.session)
      .setup((instance) => instance.relay(It.IsAny()))
      .callback(({ args: [{ data, node, blockchain }] }) => Promise.resolve(this._sendRelay(data, node, blockchain)))

    return repoMock.object()
  }

  /**
   * Retrieves a mocked class of pocketjs with the configured options
   * @returns pocketjs class with mocked functions
   */
  class(): typeof Relayer {
    const repoMock = new Mock<typeof Relayer>({ target: Relayer })
      .setup((instance) => new instance(It.IsAny()))
      .returns(this.object())

    return repoMock.object()
  }

  /**
   * Obtain relay values that  can be a single type or array, when an array is given, the response will follow
   * the index of the array for each response and the final item when the requests exceededs the array length
   * @param data relay request payload
   * @returns response payload or RpcError if it wasn't previously defined
   */
  _getRelayResponse(data: string): MockRelayResponse {
    if (!this.relayResponse.hasOwnProperty(data)) {
      return new PocketCoreError(0, 'relay request not set on map')
    }

    if (!Array.isArray(this.relayResponse[data])) {
      return this.relayResponse[data] as MockRelayResponse
    }

    const relayArray = this.relayResponse[data] as MockRelayResponse[]

    if (!this.relayCounter.hasOwnProperty(data)) {
      this.relayCounter[data] = 0
    }

    const idx = this.relayCounter[data] < relayArray.length ? this.relayCounter[data] : relayArray.length - 1

    this.relayCounter[data]++

    return relayArray[idx]
  }

  /**
   * Simulates a relay request and returns a response previously saved on the `relayResponse` property prior object/class instantiation
   * @param data relay request payload
   * @returns response payload of request
   */
  _sendRelay(data: string, node?: Node, blockchain = '0027'): RelayResponse {
    const nodePublicKey = node ? node.publicKey : '142e2b65610a798b0e4e3f45927ae0b986a71852039c28a625dcf11d2fc48637'

    let relayResponse

    const _relayResponse = this._getRelayResponse(data)

    if (_relayResponse instanceof Error) {
      throw _relayResponse
    } else if (typeof _relayResponse !== 'string') {
      relayResponse = _relayResponse
    } else {
      if (this.fail) {
        throw rpcMockError
      }

      relayResponse = {
        response: _relayResponse,
        relayProof: {
          entropy: 32889,
          sessionBlockheight: 100,
          servicerPubKey: nodePublicKey,
          blockchain,
          aat: {
            version: '0.0.1',
            appPubKey: '657008a612d86c4f8c43c8d46094c04aedc7dc36b2a6dbc5af168aeaf52f1750',
            clientPubKey: '06t6wkhjtr3ezmgzd9n1hl3ofahkdfqoutuf27mvy5xeqb2tqondk5lkhihxwza4',
            signature:
              '7h0kixql89qw9muz2uel2zao5xuk546slj2d6hv2psgbjte0m0gbrgj1co3oprhtfd3vlx7pboyzpbcwvnfyxrtdxiff1t34mp3cmepobdsbvwb5k5lsfrnkdbf9mh6i',
          },
          signature: 'vvfdfd9iiw9q-trfjsjsdwd',
          requestHash: 'duesofpisdnidsirpww',
        },
        serviceNode: node,
      } as RelayResponse
    }

    return relayResponse
  }
}
