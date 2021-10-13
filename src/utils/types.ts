import { HTTPMethod } from '@pokt-network/pocket-js'
import { Applications } from '../models'
import { SyncCheckOptions } from '../services/sync-checker'

export type BlockchainDetails = {
  blockchain: string
  blockchainEnforceResult: string
  blockchainSyncCheck: SyncCheckOptions
  blockchainIDCheck: string
  blockchainID: string
  blockchainChainID: string
  blockchainLogLimitBlocks: number
}

export type SendRelayOptions = {
  rawData: object | string
  relayPath: string
  httpMethod: HTTPMethod
  application: Applications
  requestID: string
  requestTimeOut?: number
  overallTimeOut?: number
  relayRetries?: number
  logLimitBlocks?: number
}
