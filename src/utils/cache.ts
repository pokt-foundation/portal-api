import { Node, Session } from '@pokt-foundation/pocketjs-types'
import * as cacheManager from 'cache-manager'

const logger = require('../services/logger')

/**
 * Removes node from cached session, following calls within the same session,
 * also cleans the chain/sync check cache to prevent using invalid nodes
 * @param redis cache service to use
 * @param blockchainID blockchain where session resides
 * @param nodes session nodes
 * @param nodePubKey node to remove's public key
 * @returns
 */
export async function removeNodeFromSession(
  redis: cacheManager.Cache,
  { key, nodes }: Session,
  nodePubKey: string,
  removeChecksFromCache = false,
  requestID?: string,
  blockchainID?: string
): Promise<void> {
  const sessionCacheKey = `session-key-${key}`

  await redis.sadd(sessionCacheKey, nodePubKey)
  const nodesToRemoveTTL = await redis.ttl(sessionCacheKey)

  if (nodesToRemoveTTL < 0) {
    await redis.expire(sessionCacheKey, 3600) // 1 hour
  }

  logger.log('warn', 'Exhausted node removed', {
    sessionKey: key,
    serviceNode: nodePubKey,
    requestID,
    blockchainID,
  })

  if (removeChecksFromCache) {
    await removeChecksCache(redis, key, nodes)
  }
}

export async function removeSessionCache(
  redis: cacheManager.Cache,
  publicKey: string,
  blockchainID: string
): Promise<void> {
  await redis.del(`session-cached-${publicKey}-${blockchainID}`)
}

export async function removeChecksCache(redis: cacheManager.Cache, sessionKey: string, nodes: Node[]) {
  await redis.del(`sync-check-${sessionKey}`)
  await redis.del(`chain-check-${sessionKey}`)
}
