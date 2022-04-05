import { Node, Session } from '@pokt-foundation/pocketjs-types'
import axios, { AxiosRequestConfig } from 'axios'
import { Redis } from 'ioredis'
import { Cache } from '../services/cache'

const logger = require('../services/logger')

/**
 * Removes node from cached session, following calls within the same session,
 * also cleans the chain/sync check cache to prevent using invalid nodes
 * @param cache cache service to use
 * @param blockchainID blockchain where session resides
 * @param nodes session nodes
 * @param nodePubKey node to remove's public key
 * @returns
 */
export async function removeNodeFromSession(
  cache: Cache,
  { key, nodes }: Session,
  nodePubKey: string,
  removeChecksFromCache = false,
  requestID?: string,
  blockchainID?: string
): Promise<void> {
  const sessionCacheKey = `session-key-${key}`

  await cache.sadd(sessionCacheKey, nodePubKey)
  const nodesToRemoveTTL = await cache.ttl(sessionCacheKey)

  if (nodesToRemoveTTL < 0) {
    await cache.expire(sessionCacheKey, 3600) // 1 hour
  }

  logger.log('warn', 'Exhausted node removed', {
    sessionKey: key,
    serviceNode: nodePubKey,
    requestID,
    blockchainID,
  })

  if (removeChecksFromCache) {
    await removeChecksCache(cache, key, nodes)
  }
}

export async function removeSessionCache(cache: Cache, publicKey: string, blockchainID: string): Promise<void> {
  await cache.del(`session-cached-${publicKey}-${blockchainID}`)
}

export async function removeChecksCache(cache: Cache, sessionKey: string, nodes: Node[]) {
  await cache.del(`sync-check-${sessionKey}`)
  await cache.del(`chain-check-${sessionKey}`)
}

export async function getRDSCertificate(redis: Redis, certificateUrl: string): Promise<string> {
  const cachedCertificate = await redis.get('psqlCertificate')
  let publicCertificate

  if (!cachedCertificate) {
    try {
      const axiosConfig = {
        method: 'GET',
        url: certificateUrl,
      } as AxiosRequestConfig

      const { data: rdsCertificate } = await axios(axiosConfig)

      publicCertificate = rdsCertificate
    } catch (e) {
      throw new Error('Invalid Certificate')
    }

    await redis.set('psqlCertificate', publicCertificate, 'EX', 600)
  } else {
    publicCertificate = cachedCertificate
  }

  return publicCertificate
}
