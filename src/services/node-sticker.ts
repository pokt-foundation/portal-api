/* eslint-disable @typescript-eslint/no-floating-promises */
import { Redis } from 'ioredis'
import { getAddressFromPublicKey } from 'pocket-tools'
import { Node } from '@pokt-network/pocket-js'
import { checkWhitelist } from '../utils/enforcements'
import { StickinessOptions } from '../utils/types'
import { RateLimiter } from './rate-limiter'

export type StickyResult = 'SUCCESS' | 'FAILURE' | 'NONE'

const logger = require('./logger')

const ERROR_COUNT_LIMIT = 5

// Utility class to contain several methods regarding node stickiness configuration.
export class NodeSticker {
  stickiness: boolean
  duration: number
  preferredNodeAddress: string
  keyPrefix?: string
  rpcID?: number
  relaysLimit?: number
  stickyOrigins?: string[]
  rpcIDThreshold: number

  redis: Redis
  blockchainID: string
  ipAddress: string
  data?: string | object
  requestID?: string
  typeID?: string
  relaysLimiter: RateLimiter
  errorsLimiter: RateLimiter

  nextRPCID?: number
  clientStickyKey: string
  clientErrorKey: string
  clientLimitKey: string

  constructor(
    {
      stickiness,
      duration,
      keyPrefix,
      rpcID,
      relaysLimit,
      preferredNodeAddress,
      stickyOrigins,
      rpcIDThreshold,
    }: StickinessOptions,
    blockchainID: string,
    ipAddress: string,
    redis: Redis,
    data?: string | object,
    requestID?: string,
    typeID?: string
  ) {
    this.stickiness = stickiness
    this.preferredNodeAddress = preferredNodeAddress
    this.duration = duration
    this.keyPrefix = keyPrefix
    this.rpcID = rpcID
    this.relaysLimit = relaysLimit
    this.stickyOrigins = stickyOrigins
    this.rpcIDThreshold = rpcIDThreshold

    this.blockchainID = blockchainID
    this.ipAddress = ipAddress
    this.redis = redis
    this.data = data
    this.requestID = requestID
    this.typeID = typeID

    // If no key prefix is given, set based on rpcID.
    // Prefix is needed in case the rpcID is not used due to the way the key works.
    // If the key only had ip and blockcChainID, then could happen the unlikely case
    // where when connected to two different apps that both have stickiness on,
    // one will overwrite the other with its session node and the other will have an
    // invalid node to send relays to resulting in a cascade of failures.
    if (keyPrefix) {
      this.clientStickyKey = this.buildClientStickyKey(keyPrefix)
    } else if (rpcID > 0 && data) {
      this.nextRPCID = NodeSticker.getNextRPCID(this.rpcID, data)

      this.clientStickyKey = this.buildClientStickyKey(this.nextRPCID.toString())
    }

    this.clientErrorKey = `${this.clientStickyKey}-errors`
    this.clientLimitKey = `${this.clientStickyKey}-limit`

    // Limit for rpcID stickiness is of one request at most as the id is not static
    this.relaysLimiter = new RateLimiter(this.clientLimitKey, redis, [], relaysLimit || 1, this.duration)
    this.errorsLimiter = new RateLimiter(this.clientErrorKey, redis, [], ERROR_COUNT_LIMIT, this.duration)
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

  buildClientStickyKey(prefix: string, suffix?: string): string {
    return `sticky-${prefix}-${this.ipAddress}-${this.blockchainID}${suffix ? `-${suffix}` : ''}`
  }

  async getStickyNode(nodes: Node[], exhaustedNodes: string[]): Promise<Node | undefined> {
    const preferredNodeIndex = nodes.findIndex(({ address }) => address === this.preferredNodeAddress)

    if (preferredNodeIndex < 0) {
      return undefined
    }

    // Remove stickiness if node is exhausted
    if (
      exhaustedNodes.some(async (publicKey) => (await getAddressFromPublicKey(publicKey)) === this.preferredNodeAddress)
    ) {
      await this.remove('exhausted node')
      return undefined
    }

    // If node have exceeding errors, remove stickiness.
    const errorCount = await this.getErrorCount()

    if (errorCount > ERROR_COUNT_LIMIT) {
      await this.remove('error limit exceeded')
      return undefined
    }

    return nodes[preferredNodeIndex]
  }

  async setStickinessKey(
    applicationID: string,
    nodeAddress: string,
    origin?: string,
    relayLimiter = true
  ): Promise<void> {
    if (!this.stickiness || (!this.keyPrefix && !this.rpcID)) {
      return
    }

    if (!checkWhitelist(this.stickyOrigins, origin, 'substring')) {
      return
    }

    if (this.keyPrefix) {
      // Check if key is already set to rotate the selected node when the
      // sticky duration ends
      const nextRequest = await this.redis.get(this.clientStickyKey)

      if (!nextRequest) {
        await this.redis.set(this.clientStickyKey, JSON.stringify({ applicationID, nodeAddress }), 'EX', this.duration)
      }

      if (relayLimiter && this.relaysLimit) {
        await this.checkRelaysLimit()
      }
    } else {
      if (this.rpcID > 0) {
        const keySets = []

        // rpcID requests are not strictly consecutive and might happen at almost the same time
        for (let i = 0; i < this.rpcIDThreshold; i++) {
          const clientStickyKey = this.buildClientStickyKey((this.nextRPCID + i).toString())

          keySets.push(
            this.redis.set(clientStickyKey, JSON.stringify({ applicationID, nodeAddress }), 'EX', this.duration)
          )
        }

        await Promise.allSettled(keySets)
      }
    }
  }

  // Limit needs to be set for some apps as they can overflow session nodes.
  async checkRelaysLimit(): Promise<void> {
    const exceeded = await this.relaysLimiter.checkLimit(true)

    if (exceeded) {
      this.remove('relays limit exceeded')
    }
  }

  async remove(reason?: string): Promise<void> {
    logger.log('warn', 'sticky node forcefully removed', {
      reason,
      requestID: this.requestID,
      typeID: this.typeID,
      blockchainID: this.blockchainID,
      serviceNode: this.preferredNodeAddress,
    })

    await this.relaysLimiter.remove(false, this.clientStickyKey, this.clientErrorKey, this.clientLimitKey)
  }

  async increaseErrorCount(): Promise<number> {
    return this.errorsLimiter.increase()
  }

  async getErrorCount(): Promise<number> {
    return Number.parseInt((await this.redis.get(this.clientErrorKey)) || '0')
  }
}
