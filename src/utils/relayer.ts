import { Redis } from 'ioredis'
import { HTTPMethod, Node } from '@pokt-network/pocket-js'
import { SyncCheckOptions } from '../services/sync-checker'
import { Applications } from '../models'

// Fetch node client type if Ethereum based
export async function fetchClientTypeLog(
  redis: Redis,
  blockchainID: string,
  id: string | undefined
): Promise<string | null> {
  const clientTypeLog = await redis.get(blockchainID + '-' + id + '-clientType')

  return clientTypeLog
}

export function isCheckPromiseResolved(promise: PromiseSettledResult<Node[]>): boolean {
  return promise.status === 'fulfilled' && promise.value !== undefined && promise.value.length > 0
}

export function filterCheckedNodes(syncCheckNodes: Node[], chainCheckedNodes: Node[]): Node[] {
  // Filters out nodes that passed both checks.
  const nodes = syncCheckNodes.filter((syncCheckNode) =>
    chainCheckedNodes.some((chainCheckedNode) => syncCheckNode.publicKey === chainCheckedNode.publicKey)
  )

  return nodes
}

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
