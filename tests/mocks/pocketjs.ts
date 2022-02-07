/* eslint-disable no-prototype-builtins */
import { URL } from 'url'
import { Mock, It } from 'moq.ts'
import {
  Pocket,
  Configuration,
  HttpRpcProvider,
  Session,
  SessionManager,
  SessionHeader,
  Node,
  StakingStatus,
  RelayResponse,
  RpcError,
  RelayRequest,
  RelayPayload,
  HTTPMethod,
  RelayProofResponse,
  PocketAAT,
  RelayMeta,
  RelayProof,
  RequestHash,
  Keybase,
  Account,
} from '@pokt-network/pocket-js'
import { DEFAULT_POCKET_CONFIG } from '../../src/config/pocket-config'

export const DEFAULT_NODES = [
  new Node(
    '4decdda1c176daf9d70f482e1d7ac476eb57b7ae',
    '3babba8b6a4a3d94e6a3d01d9e1ac15f8d5331f605b06421e5be1720d5a56867',
    false,
    StakingStatus.Staked,
    BigInt(15145000000),
    'https://validator0.org/',
    ['0001', '0027', '0021', '0040']
  ),
  new Node(
    '4ebc3a58b2c3e6ea59762f7d9f502e97a6901bac',
    '61393a9f1cc7f97cbd8925c6a4337acdb4de6e869ed427b040ad19c04decb30b',
    false,
    StakingStatus.Staked,
    BigInt(15145000000),
    'https://validator1.org/',
    ['0009', '0027', '0012', '0010', '0040']
  ),
  new Node(
    'b8c70edb826a33d15876d0926ab08d98d6f0bb23',
    '2b0912cf2aae7c59cf792ecf5574e42cbeb5c4161b40c783df7ed1683a36fc69',
    false,
    StakingStatus.Staked,
    BigInt(15150000000),
    'https://validator2.org/',
    ['0008', '0015', '0020', '0018', '0040']
  ),
  new Node(
    '1bf7e0bda6e0e3deea77a5044d11840e73b39e63',
    'c431461fbd65044643902d430670a6ccc30dbf81b027f66a864cca701a653822',
    false,
    StakingStatus.Staked,
    BigInt(15373984626),
    'https://validator3.org/',
    ['0012', '0021', '0022', '0015', '0040']
  ),
  new Node(
    'fb519210c9c0c531a5e73b2c114c5ff8354b301c',
    '198fe21570be39cb7fd33928cf9f2699cb20b43ef704e4cc52045ace48799b19',
    false,
    StakingStatus.Staked,
    BigInt(15369984630),
    'https://validator4.org/',
    ['0027', '0002', '0004', '0022', '0040']
  ),
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
  CONFIGURATION: new Configuration(
    DEFAULT_POCKET_CONFIG.maxDispatchers,
    DEFAULT_POCKET_CONFIG.maxSessions,
    DEFAULT_POCKET_CONFIG.consensusNodeCount,
    DEFAULT_POCKET_CONFIG.requestTimeout,
    DEFAULT_POCKET_CONFIG.acceptDisputedResponses,
    4,
    1038000,
    DEFAULT_POCKET_CONFIG.validateRelayResponses,
    DEFAULT_POCKET_CONFIG.rejectSelfSignedCertificates,
    DEFAULT_POCKET_CONFIG.useLegacyTxCodec
  ),
  NODES: DEFAULT_NODES,
  SESSION: new Session(
    new SessionHeader('abc07a64080fe578c766cb8c6e54278c84b1fd90113755e95cb24046d851967d', '0027', BigInt(32617)),
    '9Uom8pUA7agH9bSZUzLLwZVQFMK5fEQoh9VkpOxI3bQ=',
    DEFAULT_NODES
  ),
}

export type MockRelayResponse = string | RelayResponse | RpcError

export class PocketMock {
  dispatchers: URL[]
  rpcProvider: HttpRpcProvider
  configuration: Configuration
  nodes: Node[]
  fail = false
  rpcMockError = new RpcError('500', 'Mock error')
  relayResponse: Record<string, MockRelayResponse | Array<MockRelayResponse>> = {
    '{"method":"eth_blockNumber","params":[],"id":1,"jsonrpc":"2.0"}': '{"id":1,"jsonrpc":"2.0","result":"0x1083d57"}',
  }
  relayCounter: Record<string, number>
  session = DEFAULT_MOCK_VALUES.SESSION

  constructor(dispatchers?: URL[], rpcProvider?: HttpRpcProvider, configuration?: Configuration) {
    // Cannot set rpcProvider without setting the dispatchers as it depends on them
    if (rpcProvider && !dispatchers) {
      throw new Error('Cannot set rpcProvider without dispatchers')
    }

    this.dispatchers = dispatchers || DEFAULT_MOCK_VALUES.DISPATCHERS
    this.rpcProvider = rpcProvider || new HttpRpcProvider(DEFAULT_MOCK_VALUES.DISPATCHERS[0])
    this.configuration = configuration || DEFAULT_MOCK_VALUES.CONFIGURATION

    this.relayCounter = {}
  }

  /**
   * Retrieves an object instance of pocketjs  with the configured options
   * @returns pocketjs instance with mocked functions
   */
  object(): Pocket {
    // Default mock functions
    // TODO: Implement custom results
    const sessionManager = new Mock<SessionManager>()
      .setup((instance) => instance.getCurrentSession(It.IsAny(), It.IsAny(), It.IsAny(), It.IsAny()))
      .returnsAsync(this.session)
      .object()

    const keybase = new Mock<Keybase>()
      .setup((instance) => instance.unlockAccount(It.IsAny(), It.IsAny(), It.IsAny()))
      .returns(undefined)
      .setup((instance) => instance.importAccount(It.IsAny(), It.IsAny()))
      .returnsAsync(
        new Account(
          Buffer.from('viymhp9wli51m1i9f1jyk4v4entepune', 'hex'),
          'k2dfnl30z51gvi96ajh5xateyfjytorxy7pnserri0eix1kn0fizmw5wsnjr10fd8jdatm4bdywtpjk08eamplgflnxpeyir8vakzte620ykiewwhwqy8nh8sgx9luwu'
        )
      )
      .object()

    const repoMock = new Mock<Pocket>()
      .setup((instance) => instance.sessionManager)
      .returns(sessionManager)
      .setup((instance) => instance.keybase)
      .returns(keybase)
      .setup((instance) =>
        instance.sendRelay(
          It.IsAny(),
          It.IsAny(),
          It.IsAny(),
          It.IsAny(),
          It.IsAny(),
          It.IsAny(),
          It.IsAny(),
          It.IsAny(),
          It.IsAny(),
          It.IsAny()
        )
      )
      .callback(({ args: [data, blockchain, pocketAAT, configuration, headers, method, path, node] }) =>
        Promise.resolve(this._sendRelay(data, node))
      )

    return repoMock.object()
  }

  /**
   * Retrieves a mocked class of pocketjs with the configured options
   * @returns pocketjs class with mocked functions
   */
  class(): typeof Pocket {
    const repoMock = new Mock<typeof Pocket>({ target: Pocket })
      .setup((instance) => new instance(It.IsAny(), It.IsAny(), It.IsAny()))
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
      return new RpcError('000', 'relay request not set on map')
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
  _sendRelay(data: string, node?: Node): RelayResponse | RpcError {
    const nodePublicKey = node ? node.publicKey : '142e2b65610a798b0e4e3f45927ae0b986a71852039c28a625dcf11d2fc48637'

    let relayResponse

    const _relayResponse = this._getRelayResponse(data)

    if (_relayResponse instanceof RelayResponse || _relayResponse instanceof RpcError) {
      relayResponse = _relayResponse
    } else {
      const poktAAT = new PocketAAT(
        '0.0.1',
        '657008a612d86c4f8c43c8d46094c04aedc7dc36b2a6dbc5af168aeaf52f1750',
        '06t6wkhjtr3ezmgzd9n1hl3ofahkdfqoutuf27mvy5xeqb2tqondk5lkhihxwza4',
        '7h0kixql89qw9muz2uel2zao5xuk546slj2d6hv2psgbjte0m0gbrgj1co3oprhtfd3vlx7pboyzpbcwvnfyxrtdxiff1t34mp3cmepobdsbvwb5k5lsfrnkdbf9mh6i'
      )

      relayResponse = new RelayResponse(
        'qrzn2yeyobvsb0la6au8jqykkrlgq4me2js34vl31h93lfjjrxxnvmrjibqozlbnnil3em7qhgkz3ipinhvgeevjbcxzqc06htfe6z5vrougudldz34cp7k7lqec0xu7',
        _relayResponse as string,
        new RelayProofResponse(
          BigInt(17386131212264644),
          BigInt(32889),
          nodePublicKey,
          '0027',
          poktAAT,
          'c57e5076153450855e7018ab5b8de37034f04d4884f33020f339fc634228951ff1ecb69f39ab31bc6544f869f6ce10dd4cbc186fceb496d02b443a9420d09b03',
          'tfvdesrvn1bv2zeyxcrxj4evbhymbfdkqcdoavjierhqjyevtvomszgcopqucris'
        ),
        new RelayRequest(
          new RelayPayload(data, HTTPMethod.POST, '', undefined),
          new RelayMeta(BigInt(32889)),
          new RelayProof(
            BigInt(17386131212264644),
            BigInt(32889),
            nodePublicKey,
            '0027',
            poktAAT,
            'c57e5076153450855e7018ab5b8de37034f04d4884f33020f339fc634228951ff1ecb69f39ab31bc6544f869f6ce10dd4cbc186fceb496d02b443a9420d09b03',
            new RequestHash(
              new RelayPayload(data, HTTPMethod.POST, '', undefined),
              new RelayMeta(BigInt(17386131212264644))
            )
          )
        )
      )
    }
    const response = !this.fail ? relayResponse : this.rpcMockError

    return response
  }
}
