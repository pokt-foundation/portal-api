import { Redis } from 'ioredis'
import { Node } from '@pokt-network/pocket-js'
const crypto = require('crypto')

// hashes a blockchain and all of the nodes given, sorted by public key
export async function hashBlockchainNodes(blockchainID: string, nodes: Node[] = [], redis: Redis): Promise<string> {
  const sortedNodes = JSON.stringify(
    nodes.sort((a, b) => (a.publicKey > b.publicKey ? 1 : b.publicKey > a.publicKey ? -1 : 0)),
    (k, v) => (k !== 'publicKey' ? v : undefined)
  )

  const calculateHash = () => crypto.createHash('sha256').update(sortedNodes).digest('hex')

  const blockchainHashKey = `${blockchainID}-${sortedNodes}`
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
