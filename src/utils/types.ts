import { Node } from '@pokt-foundation/pocketjs-types'
import { HTTPMethod, StakingStatus } from '@pokt-network/pocket-js'
import { Applications } from '../models'
import { SyncCheckOptions } from '../services/sync-checker'

export type BlockchainDetails = {
  blockchain: string
  blockchainChainID: string
  blockchainEnforceResult: string
  blockchainID: string
  blockchainIDCheck: string
  blockchainSyncCheck: SyncCheckOptions
  blockchainLogLimitBlocks: number
}

export type SendRelayOptions = {
  application: Applications
  stickinessOptions: StickinessOptions
  httpMethod: HTTPMethod
  overallTimeOut?: number
  rawData: object | string
  relayPath: string
  requestID: string
  requestTimeOut?: number
  relayRetries?: number
  logLimitBlocks?: number
  applicationID?: string
  applicationPublicKey?: string
}

export type StickinessOptions = {
  stickiness: boolean
  preferredNodeAddress: string
  duration: number
  relaysLimit?: number
  keyPrefix?: string
  rpcID?: number
  stickyOrigins?: string[]
  rpcIDThreshold?: number
}

export type CheckResult = {
  nodes: Node[]
  cached: boolean
}

export type NodeAxiosResponse = {
  address: string
  chains: string[]
  jailed: boolean
  public_key: string
  service_url: string
  status: StakingStatus
  tokens: string
  unstakingTime: string
}

export type DispatchNewSessionRequest = {
  app_public_key: string
  chain: string
  session_height: number
}

// TODO: Remove once is implemented within pocket-js-slim
export type RelayResponse = {
  response: string
  relayProof: {
    entropy: number
    sessionBlockHeight: number
    servicerPubKey: string
    blockchain: string
    aat: {
      version: string
      appPubKey: string
      clientPubKey: string
      signature: string
    }
    signature: string
    requestHash: string
    serviceNode: Node
  }
}
