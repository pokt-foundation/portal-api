import { Node } from '@pokt-foundation/pocketjs-types'
import * as cacheManager from 'cache-manager'
import { getAddressFromPublicKey } from 'pocket-tools'
import { checkWhitelist } from '../utils/enforcements'
import { StickinessOptions } from '../utils/types'

export type StickyResult = 'SUCCESS' | 'FAILURE' | 'NONE'

const logger = require('./logger')

const ERROR_COUNT_LIMIT = 5

// Small utility class to contain several methods regarding node stickiness configuration.
export class NodeSticker {
  stickiness: boolean
  duration: number
  preferredNodeAddress: string
  keyPrefix?: string
  rpcID?: number
  relaysLimit?: number
  stickyOrigins?: string[]
  rpcIDThreshold: number

  redis: cacheManager.Cache
  blockchainID: string
  ipAddress: string
  data?: string | object
  requestID?: string
  typeID?: string

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
    redis: cacheManager.Cache,
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
    return `${prefix}-${this.ipAddress}-${this.blockchainID}${suffix ? `-${suffix}` : ''}`
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
        await this.redis.set(this.clientStickyKey, JSON.stringify({ applicationID, nodeAddress }), {
          ttl: this.duration,
        })
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
            this.redis.set(clientStickyKey, JSON.stringify({ applicationID, nodeAddress }), { ttl: this.duration })
          )
        }

        await Promise.allSettled(keySets)
      }
    }
  }

  // Limit needs to be set for some apps as they can overflow session nodes
  // await is not used here as the value does not need to be exact, a small
  // overflow is allowed.
  async checkRelaysLimit(): Promise<void> {
    const relaysDone = Number.parseInt((await this.redis.get(this.clientLimitKey)) || '0')

    this.redis.incr(this.clientLimitKey)

    if (!relaysDone) {
      this.redis.expire(this.clientLimitKey, this.duration)
    } else if (relaysDone >= this.relaysLimit) {
      await this.remove('relays limit exceeded')
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

    await this.redis.del(this.clientStickyKey)
    await this.redis.del(this.clientErrorKey)
    await this.redis.del(this.clientLimitKey)
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
