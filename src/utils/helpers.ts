import { Node } from '@pokt-network/pocket-js'
const crypto = require('crypto')

// hashes a blockchain and all of the nodes given, sorted by public key
export function hashBlockchainNodes(blockchainID: string, nodes: Node[] = []): string {
  return `${blockchainID}-${crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        nodes.sort((a, b) => (a.publicKey > b.publicKey ? 1 : b.publicKey > a.publicKey ? -1 : 0)),
        (k, v) => (k !== 'publicKey' ? v : undefined)
      )
    )
    .digest('hex')}`
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

// Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random
export function getRandomInt(min: number, max: number): number {
  min = Math.ceil(min)
  max = Math.floor(max)
  return Math.floor(Math.random() * (max - min) + min) //The maximum is exclusive and the minimum is inclusive
}
