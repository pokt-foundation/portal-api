import { Node } from '@pokt-foundation/pocketjs-types'
import * as cacheManager from 'cache-manager'
import { Applications } from '../models/applications.model'

// hashes a blockchain and all of the nodes given, sorted by public key
export async function hashBlockchainNodes(
  blockchainID: string,
  nodes: Node[] = [],
  redis: cacheManager.Cache
): Promise<string> {
  const sortedNodes = nodes.sort((a, b) => (a.publicKey > b.publicKey ? 1 : b.publicKey > a.publicKey ? -1 : 0))

  const sortedNodesStr = JSON.stringify(sortedNodes, (k, v) => (k !== 'publicKey' ? v : undefined))

  const calculateHash = () => sortedNodes.map((node) => node.publicKey.slice(0, 5)).join('')

  const blockchainHashKey = `${blockchainID}-${sortedNodesStr}`
  let blockchainHash = await redis.get(blockchainHashKey)

  if (!blockchainHash) {
    blockchainHash = `${blockchainID}-${calculateHash()}`
    await redis.set(blockchainHashKey, blockchainHash, { ttl: 300 })
  }

  return blockchainHash as string
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
  return Math.floor(Math.random() * (max - min) + min) // The maximum is exclusive and the minimum is inclusive
}

// Source: https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
export function shuffle<T>(array: T[]): T[] {
  let currentIndex = array.length
  let randomIndex: number

  // While there remain elements to shuffle...
  while (currentIndex !== 0) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex)
    currentIndex--

    // And swap it with the current element.
    ;[array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]]
  }

  return array
}

// TODO: Remove once database fields are normalized
// Due to some changes in schema from the database, the public key field is scattered accross
// several other parent fields depending on when the app was created
export function getApplicationPublicKey(application: Applications): string {
  // Is on freetierApplicationAccount field
  if (Boolean(application.freeTierApplicationAccount) && application.freeTierApplicationAccount?.publicKey) {
    return application.freeTierApplicationAccount.publicKey
    // Or on publicPocketAccount field
  } else if (Boolean(application.publicPocketAccount) && application.publicPocketAccount?.publicKey) {
    return application.publicPocketAccount.publicKey
  }

  // Must be on gatewayAAT, otherwise the app wouldn't work
  return application.gatewayAAT.applicationPublicKey
}
