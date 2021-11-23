/* eslint-disable @typescript-eslint/no-floating-promises */
import { Redis } from 'ioredis'
import { getAddressFromPublicKey } from 'pocket-tools'
import { StickinessOptions } from '../utils/types'

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
  ): Promise<string> {
    if (!preferredNodeAddress) {
      return 'NONE'
    }

    return preferredNodeAddress === (await getAddressFromPublicKey(relayNodePublicKey)) ? 'SUCCESS' : 'FAILURE'
  }

  async setStickinessKey(
    blockchainID: string,
    applicationID: string,
    nodeAddress: string,
    relayLimiter = true,
    requestID?: string
  ): Promise<void> {
    if (!this.stickiness || (!this.keyPrefix && !this.rpcID)) {
      return
    }
    let nextRequest

    if (this.keyPrefix) {
      // Check if key is already set to rotate the selected node when the
      // sticky duration ends
      nextRequest = await this.redis.get(this.clientStickyKey)

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
      await this.checkRelaysLimit(requestID, nextRequest)
    }
  }

  // Limit needs to be set for some apps as they can overflow session nodes
  // await is not used here as the value does not need to be exact, a small
  // overflow is allowed.
  async checkRelaysLimit(requestID?: string, cache?: string): Promise<void> {
    const limitKey = `${this.clientStickyKey}-limit`

    const relaysDone = Number.parseInt((await this.redis.get(limitKey)) || '0')

    this.redis.incr(limitKey)

    logger.log('info', `relays done on ${limitKey}: ${relaysDone} `, {
      requestID,
      cache,
      preferredNodeAddress: this.preferredNodeAddress,
    })

    if (!relaysDone) {
      this.redis.expire(limitKey, this.duration)
    } else if (relaysDone >= this.relaysLimit) {
      this.redis.del(limitKey)
      await this.remove()
    }
  }

  async remove(): Promise<void> {
    await this.redis.del(this.clientStickyKey)
  }
}
