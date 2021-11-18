import { HTTPMethod } from '@pokt-network/pocket-js'
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
  rpcID?: number
  preferredNodeAddress?: string
  stickinessDuration?: number
  httpMethod: HTTPMethod
  overallTimeOut?: number
  rawData: object | string
  relayPath: string
  requestID: string
  requestTimeOut?: number
  relayRetries?: number
  logLimitBlocks?: number
}
