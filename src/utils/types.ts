import { Node, HTTPMethod, StakingStatus } from '@pokt-foundation/pocketjs-types'
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
  blockchainPath: string
  blockchainAltruist: string
  blockchainRedirects: BlockchainRedirect[]
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: any
  relayProof: {
    entropy: number
    sessionBlockheight: number
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
  }
  serviceNode: Node
}

export type BlockchainRedirect = {
  alias: string
  domain: string
  loadBalancerID: string
}
