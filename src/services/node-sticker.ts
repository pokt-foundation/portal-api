/* eslint-disable @typescript-eslint/no-floating-promises */
import { Redis } from 'ioredis'
import { getAddressFromPublicKey } from 'pocket-tools'
import { Node } from '@pokt-network/pocket-js'
import { StickinessOptions } from '../utils/types'

export type StickyResult = 'SUCCESS' | 'FAILURE' | 'NONE'

const logger = require('./logger')

// Small utility class to contain several methods regarding node stickiness configuration.
export class NodeSticker {
  stickiness: boolean
  duration: number
  keyPrefix?: string
  rpcID?: number
  relaysLimit?: number
  preferredNodeAddress: string

  blockchainID: string
  ipAddress: string
  redis: Redis
  data?: string | object

  clientStickyKey: string
  clientErrorKey: string
  clientLimitKey: string

  constructor(
    { stickiness, duration, keyPrefix, rpcID, relaysLimit, preferredNodeAddress }: StickinessOptions,
    blockchainID: string,
    ipAddress: string,
    redis: Redis,
    data?: string | object
  ) {
    this.stickiness = stickiness
    this.duration = duration
    this.keyPrefix = keyPrefix
    this.rpcID = rpcID
    this.relaysLimit = relaysLimit
    this.preferredNodeAddress = preferredNodeAddress

    this.blockchainID = blockchainID
    this.ipAddress = ipAddress
    this.redis = redis
    this.data = data

    // If no key prefix is given, set based on rpcID.
    // Prefix is needed in case the rpcID is not used due to the way the key works.
    // If the key only had ip and blockcChainID, then could happen the unlikely case
    // where when connected to two different apps that both have stickiness on,
    // one will overwrite the other with its session node and the other will have an
    // invalid node to send relays to resulting in a cascade of failures.
    if (keyPrefix) {
      this.clientStickyKey = `${this.keyPrefix}-${this.ipAddress}-${blockchainID}`
    } else if (rpcID > 0 && data) {
      const nextRPCID = NodeSticker.getNextRPCID(this.rpcID, data)

      this.clientStickyKey = `${nextRPCID}-${this.ipAddress}-${blockchainID}`
    }

    this.clientErrorKey = `${this.clientStickyKey}-errors`
    this.clientLimitKey = `${this.clientStickyKey}-limit`
  }

  static getNextRPCID(rpcID: number, rawData: string | object): number {
    const parsedRawData = Object.keys(rawData).length > 0 ? JSON.parse(rawData.toString()) : JSON.stringify(rawData)
    let nextRPCID = rpcID + 1

    // If this was a stacked RPC call with multiple calls in an array, increment the RPC ID accordingly
    if (parsedRawData instanceof Array) {
      nextRPCID = rpcID + parsedRawData.length
    }

    return nextRPCID
  }

  static async stickyRelayResult(
    preferredNodeAddress: string | undefined,
    relayNodePublicKey: string
  ): Promise<StickyResult> {
    if (!preferredNodeAddress) {
      return 'NONE'
    }

    return preferredNodeAddress === (await getAddressFromPublicKey(relayNodePublicKey)) ? 'SUCCESS' : 'FAILURE'
  }

  async getStickyNode(
    nodes: Node[],
    exhaustedNodes: string[],
    requestID?: string,
    blockchainID?: string,
    applicationID?: string
  ): Promise<Node | undefined> {
    const preferredNodeIndex = nodes.findIndex(({ address }) => address === this.preferredNodeAddress)

    if (preferredNodeIndex < 0) {
      return undefined
    }

    // Remove stickiness if node is exhausted
    if (
      exhaustedNodes.some(async (publicKey) => (await getAddressFromPublicKey(publicKey)) === this.preferredNodeAddress)
    ) {
      await this.remove(requestID, blockchainID, applicationID)
      return undefined
    }

    // If node have exceeding errors, remove stickiness.
    const errorCount = await this.getErrorCount()

    if (errorCount > 5) {
      await this.remove(requestID, blockchainID, applicationID)
      return undefined
    }

    return nodes[preferredNodeIndex]
  }

  async setStickinessKey(
    blockchainID: string,
    applicationID: string,
    nodeAddress: string,
    relayLimiter = true
  ): Promise<void> {
    if (!this.stickiness || (!this.keyPrefix && !this.rpcID)) {
      return
    }

    if (this.keyPrefix) {
      // Check if key is already set to rotate the selected node when the
      // sticky duration ends
      const nextRequest = await this.redis.get(this.clientStickyKey)

      if (!nextRequest) {
        await this.redis.set(this.clientStickyKey, JSON.stringify({ applicationID, nodeAddress }), 'EX', this.duration)
      }
    } else {
      if (this.rpcID > 0) {
        await this.redis.set(this.clientStickyKey, JSON.stringify({ applicationID, nodeAddress }), 'EX', this.duration)

        const nextRPCID = NodeSticker.getNextRPCID(this.rpcID, this.data)

        // Some rpcID requests skips one number when sending them consecutively
        const nextClientStickyKey = `${this.ipAddress}-${blockchainID}-${nextRPCID + 1}`

        await this.redis.set(nextClientStickyKey, JSON.stringify({ applicationID, nodeAddress }), 'EX', this.duration)
      }
    }

    if (relayLimiter && this.relaysLimit) {
      await this.checkRelaysLimit()
    }
  }

  // Limit needs to be set for some apps as they can overflow session nodes
  // await is not used here as the value does not need to be exact, a small
  // overflow is allowed.
  async checkRelaysLimit(): Promise<void> {
    const limitKey = `${this.clientStickyKey}-limit`

    const relaysDone = Number.parseInt((await this.redis.get(limitKey)) || '0')

    this.redis.incr(limitKey)

    if (!relaysDone) {
      this.redis.expire(limitKey, this.duration)
    } else if (relaysDone >= this.relaysLimit) {
      await this.remove()
    }
  }

  async remove(requestID?: string, blockchainID?: string, typeID?: string): Promise<void> {
    logger.log('info', 'sticky node forcefully removed', {
      requestID,
      typeID,
      blockchainID,
      serviceNode: this.preferredNodeAddress,
    })

    await this.redis.del(this.clientStickyKey, this.clientErrorKey, this.clientLimitKey)
  }

  async increaseErrorCount(): Promise<number> {
    const count = await this.redis.incr(this.clientErrorKey)

    await this.redis.expire(this.clientErrorKey, this.duration)
    return count
  }

  async getErrorCount(): Promise<number> {
    return Number.parseInt((await this.redis.get(this.clientErrorKey)) || '0')
  }
}
