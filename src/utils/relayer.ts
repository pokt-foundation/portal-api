import { Node } from '@pokt-foundation/pocketjs-types'
import { Redis } from 'ioredis'
import jsonrpc, { ErrorObject } from 'jsonrpc-lite'

import { Blockchains } from '../models'
import { Cache } from '../services/cache'
import { PHDClient, PHDPaths, PHDCacheKeys } from '../services/phd-client'
import { SyncCheckOptions } from '../services/sync-checker'
import { BlockchainDetails, CheckResult, BlockchainRedirect } from './types'

// Fetch node client type if Ethereum based
export async function fetchClientTypeLog(
  redis: Redis,
  blockchainID: string,
  id: string | undefined
): Promise<string | null> {
  const clientTypeLog = await redis.get(`${blockchainID}-${id}-clientType`)

  return clientTypeLog
}

export function isCheckPromiseResolved(promise: PromiseSettledResult<CheckResult>): boolean {
  return promise.status === 'fulfilled' && promise.value !== undefined && promise.value.nodes.length > 0
}

export function filterCheckedNodes(syncCheckNodes: Node[], chainCheckedNodes: Node[]): Node[] {
  // Filters out nodes that passed both checks.
  return syncCheckNodes.filter((syncCheckNode) =>
    chainCheckedNodes.some((chainCheckedNode) => syncCheckNode.publicKey === chainCheckedNode.publicKey)
  )
}

// Load requested blockchain by parsing the URL
export async function loadBlockchain(
  host: string,
  phdClient: PHDClient,
  cache: Cache,
  defaultLogLimitBlocks: number,
  rpcID: number
): Promise<BlockchainDetails> {
  // Load the requested blockchain
  const cachedBlockchains = await cache.get('blockchains')
  let blockchains: Blockchains[]

  if (!cachedBlockchains) {
    try {
      blockchains = await phdClient.find({ path: PHDPaths.Blockchain, cache, cacheKey: 'blockchains' })
    } catch (e) {
      throw new ErrorObject(rpcID, e)
    }
  } else {
    blockchains = JSON.parse(cachedBlockchains)
  }

  // Split off the first part of the request's host and check for matches
  const [blockchainRequest] = host.split('.')

  const [blockchainFilter] = blockchains.filter((b: { blockchainAliases: string[] }) =>
    b.blockchainAliases.some((alias) => alias.toLowerCase() === blockchainRequest.toLowerCase())
  )

  if (!blockchainFilter) {
    throw new ErrorObject(rpcID, new jsonrpc.JsonRpcError(`Incorrect blockchain: ${host}`, -32057))
  }

  let blockchainEnforceResult = ''
  let blockchainIDCheck = ''
  let blockchainID = ''
  let blockchainChainID = ''
  let blockchainLogLimitBlocks = defaultLogLimitBlocks
  let blockchainPath = ''
  let blockchainAltruist = ''
  let blockchainRedirects = [] as BlockchainRedirect[]
  const blockchainSyncCheck = {} as SyncCheckOptions

  const blockchain = blockchainFilter.blockchainAliases.find((alias: string) => {
    if (alias.toLowerCase() === blockchainRequest.toLowerCase()) {
      return alias // ex. 'eth-mainnet'
    }
  })

  blockchainID = blockchainFilter.id as string // ex. '0021'

  // Record the necessary format for the result; example: JSON
  if (blockchainFilter.enforceResult) {
    blockchainEnforceResult = blockchainFilter.enforceResult
  }
  // Sync Check to determine current blockheight
  if (blockchainFilter.syncCheckOptions) {
    blockchainSyncCheck.body = (blockchainFilter.syncCheckOptions.body || '').replace(/\\"/g, '"')
    blockchainSyncCheck.resultKey = blockchainFilter.syncCheckOptions.resultKey || ''

    // Sync Check path necessary for some chains
    blockchainSyncCheck.path = blockchainFilter.syncCheckOptions.path || ''

    // Allowance of blocks a data node can be behind
    blockchainSyncCheck.allowance = Number(blockchainFilter.syncCheckOptions.allowance || 0)
  }
  // Chain ID Check to determine correct chain
  if (blockchainFilter.chainIDCheck) {
    blockchainIDCheck = blockchainFilter.chainIDCheck.replace(/\\"/g, '"')
    blockchainChainID = blockchainFilter.chainID // ex. '100' (xdai) - can also be undefined
  }
  // Max number of blocks to request logs for, if not available, result to env
  if ((blockchainFilter.logLimitBlocks as number) > 0) {
    blockchainLogLimitBlocks = Number(blockchainFilter.logLimitBlocks)
  } else if (defaultLogLimitBlocks > 0) {
    blockchainLogLimitBlocks = defaultLogLimitBlocks
  }

  // Default path when required by a blockchain
  if (blockchainFilter.path) {
    blockchainPath = blockchainFilter.path
  }

  // Blockchain's altruist node
  if (blockchainFilter.altruist) {
    blockchainAltruist = blockchainFilter.altruist
  }

  // Redirects
  if (blockchainFilter.redirects) {
    blockchainRedirects = blockchainFilter.redirects
  }

  return Promise.resolve({
    blockchain,
    blockchainEnforceResult,
    blockchainSyncCheck,
    blockchainIDCheck,
    blockchainID,
    blockchainChainID,
    blockchainLogLimitBlocks,
    blockchainPath,
    blockchainAltruist,
    blockchainRedirects,
  } as BlockchainDetails)
}

// Get blockchain's alias by it's redirect domain
export async function getBlockchainAliasesByDomain(
  host: string,
  phdClient: PHDClient,
  redis: Cache,
  rpcID: number
): Promise<{ blockchainAliases: string[] }> {
  // Load the requested blockchain
  const cachedBlockchains = await redis.get('blockchains')
  let blockchains: Blockchains[]

  if (!cachedBlockchains) {
    blockchains = await phdClient.find({ path: PHDPaths.Blockchain, cache: redis, cacheKey: PHDCacheKeys.Blockchain })
  } else {
    blockchains = JSON.parse(cachedBlockchains)
  }

  const [blockchainFilter] = blockchains.filter((b) =>
    b.redirects?.some((rdr) => rdr.domain.toLowerCase() === host.toLowerCase())
  )

  if (!blockchainFilter) {
    throw new ErrorObject(rpcID, new jsonrpc.JsonRpcError(`Unable to find a blockchain with domain: ${host}`, -32057))
  }

  let blockchainAliases: string[]

  if (blockchainFilter.blockchainAliases) {
    blockchainAliases = blockchainFilter.blockchainAliases
  }

  return Promise.resolve({ blockchainAliases })
}
