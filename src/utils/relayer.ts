import { Redis } from 'ioredis'
import { HttpErrors } from '@loopback/rest'
import { Node } from '@pokt-network/pocket-js'

import { BlockchainsRepository } from '../repositories'
import { SyncCheckOptions } from '../services/sync-checker'
import { BlockchainDetails } from './types'

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

// Load requested blockchain by parsing the URL
export async function loadBlockchain(
  host: string,
  redis: Redis,
  blockchainsRepository: BlockchainsRepository,
  defaultLogLimitBlocks: number
): Promise<BlockchainDetails> {
  // Load the requested blockchain
  const cachedBlockchains = await redis.get('blockchains')
  let blockchains

  if (!cachedBlockchains) {
    blockchains = await blockchainsRepository.find()
    await redis.set('blockchains', JSON.stringify(blockchains), 'EX', 60)
  } else {
    blockchains = JSON.parse(cachedBlockchains)
  }

  // Split off the first part of the request's host and check for matches
  const [blockchainRequest] = host.split('.')

  const blockchainFilter = blockchains.filter(
    (b: { blockchain: string }) => b.blockchain.toLowerCase() === blockchainRequest.toLowerCase()
  )

  if (blockchainFilter[0]) {
    let blockchainEnforceResult = ''
    let blockchainIDCheck = ''
    let blockchainID = ''
    let blockchainChainID = ''
    let blockchainLogLimitBlocks = 10000 // Should never be 0
    const blockchainSyncCheck = {} as SyncCheckOptions

    const blockchain = blockchainFilter[0].blockchain // ex. 'eth-mainnet'

    blockchainID = blockchainFilter[0].hash as string // ex. '0021'

    // Record the necessary format for the result; example: JSON
    if (blockchainFilter[0].enforceResult) {
      blockchainEnforceResult = blockchainFilter[0].enforceResult
    }
    // Sync Check to determine current blockheight
    if (blockchainFilter[0].syncCheckOptions) {
      blockchainSyncCheck.body = (blockchainFilter[0].syncCheckOptions.body || '').replace(/\\"/g, '"')
      blockchainSyncCheck.resultKey = blockchainFilter[0].syncCheckOptions.resultKey || ''

      // Sync Check path necessary for some chains
      blockchainSyncCheck.path = blockchainFilter[0].syncCheckOptions.path || ''

      // Allowance of blocks a data node can be behind
      blockchainSyncCheck.allowance = parseInt(blockchainFilter[0].syncCheckOptions.allowance || 0)
    }
    // Chain ID Check to determine correct chain
    if (blockchainFilter[0].chainIDCheck) {
      blockchainIDCheck = blockchainFilter[0].chainIDCheck.replace(/\\"/g, '"')
      blockchainChainID = blockchainFilter[0].chainID // ex. '100' (xdai) - can also be undefined
    }
    // Max number of blocks to request logs for, if not available, result to env
    if ((blockchainFilter[0].logLimitBlocks as number) > 0) {
      blockchainLogLimitBlocks = parseInt(blockchainFilter[0].logLimitBlocks)
    } else if (defaultLogLimitBlocks > 0) {
      blockchainLogLimitBlocks = defaultLogLimitBlocks
    }

    return Promise.resolve({
      blockchain,
      blockchainEnforceResult,
      blockchainSyncCheck,
      blockchainIDCheck,
      blockchainID,
      blockchainChainID,
      blockchainLogLimitBlocks,
    } as BlockchainDetails)
  } else {
    throw new HttpErrors.BadRequest(`Incorrect blockchain: ${host}`)
  }
}
