import { Node, Session } from '@pokt-foundation/pocketjs-types'
import axios, { AxiosRequestConfig } from 'axios'
import { Redis } from 'ioredis'
import { Cache } from '../services/cache'
import { RateLimiter } from './enforcements'

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

export async function getBlockedAddresses(redis: Redis, URL: string): Promise<string[]> {
  const cachedBlockedAddresses = await redis.get('blockedAddresses')
  let blockedAddresses: string[] = []

  if (!cachedBlockedAddresses) {
    try {
      const axiosConfig = {
        method: 'GET',
        url: URL,
      } as AxiosRequestConfig

      const { data } = await axios(axiosConfig)
      const { blockedAddresses: blockedAddressList } = data

      blockedAddresses = blockedAddressList

      // The blocked addresses list gets refreshed every hour
      await redis.set('blockedAddresses', JSON.stringify(blockedAddresses), 'EX', 3600)
    } catch (e) {
      logger.log('error', 'Error fetching blocked addresses', {
        error: e?.message,
      })
    }
  } else {
    blockedAddresses = JSON.parse(cachedBlockedAddresses)
  }

  return blockedAddresses
}

export async function getRateLimitedApps(redis: Redis, rateLimiter: RateLimiter): Promise<string[]> {
  const rateLimitedAppsKey = 'rateLimitedApps'
  const cachedRateLimitedApps = await redis.get(rateLimitedAppsKey)
  let rateLimitedApps: string[] = []

  if (!cachedRateLimitedApps) {
    try {
      if (rateLimiter.URL.length > 0 && rateLimiter.token.length > 0) {
        const axiosConfig = {
          method: 'GET',
          url: rateLimiter.URL,
          headers: { Authorization: rateLimiter.token },
          timeout: 10000,
        } as AxiosRequestConfig

        const { data } = await axios(axiosConfig)
        const { applicationIDs: rateLimitedAppsList } = data

        rateLimitedApps = rateLimitedAppsList ?? []
      }
    } catch (e) {
      logger.log(
        'error',
        'Error fetching rate-limited applications list; setting cache to skip rate limited applications lookup for 300 seconds',
        {
          error: e?.message,
        }
      )
    } finally {
      // Cache is set regardless of the result, to avoid repeated calls to rate-limiter service
      if (rateLimiter.URL.length === 0) {
        logger.log('warn', 'Rate-limiter URL is empty; rate-limiting disabled')
      } else if (rateLimiter.token.length === 0) {
        logger.log('warn', 'Rate-limiter token is empty; rate-limiting disabled')
      } else if (rateLimitedApps.length === 0) {
        logger.log('warn', 'Rate-limited applications list is empty; rate-limiting disabled')
      }
      await redis.set(rateLimitedAppsKey, JSON.stringify(rateLimitedApps), 'EX', 300)
    }
  } else {
    rateLimitedApps = JSON.parse(cachedRateLimitedApps)
  }

  return rateLimitedApps.map((x) => (x ? x.toLowerCase() : ''))
}
