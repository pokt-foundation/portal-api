import { Redis } from 'ioredis'
import { Node } from '@pokt-network/pocket-js'

// hashes a blockchain and all of the nodes given, sorted by public key
export async function hashBlockchainNodes(blockchainID: string, nodes: Node[] = [], redis: Redis): Promise<string> {
  const sortedNodes = nodes.sort((a, b) => (a.publicKey > b.publicKey ? 1 : b.publicKey > a.publicKey ? -1 : 0))

  const sortedNodesStr = JSON.stringify(sortedNodes, (k, v) => (k !== 'publicKey' ? v : undefined))

  const calculateHash = () => sortedNodes.map((node) => node.publicKey.slice(0, 5)).join('')

  const blockchainHashKey = `${blockchainID}-${sortedNodesStr}`
  let blockchainHash = await redis.get(blockchainHashKey)

  if (!blockchainHash) {
    blockchainHash = `${blockchainID}-${calculateHash()}`
    await redis.set(blockchainHashKey, blockchainHash, 'EX', 300)
  }

  return blockchainHash
}

interface MeasuredPromise<T> {
  time: number
  value: T
}

export async function measuredPromise<T>(promise: T | PromiseLike<T>): Promise<MeasuredPromise<T>> {
  const start = process.hrtime()

  const value = await promise

  const elapsedTime = process.hrtime(start)

  return {
    value,
    time: (elapsedTime[0] * 1e9 + elapsedTime[1]) / 1e9,
  }
}
