import { Redis } from 'ioredis'

const RELAYS_LIMIT = 7 // relays per second
const THRESHOLD = 5 // seconds
const RATE_LIMIT = THRESHOLD * RELAYS_LIMIT

const logger = require('./logger')

export class RateLimiter {
  redis: Redis
  externalRedis: Redis[]
  key: string
  limiter: number
  threshold: number

  constructor(key: string, redis: Redis, externalRedis: Redis[], limit?: number, threshold?: number) {
    this.key = key
    this.redis = redis
    this.externalRedis = externalRedis

    this.limiter = limit || RELAYS_LIMIT
    this.threshold = threshold || THRESHOLD
  }

  async increase(rate?: number): Promise<number> {
    const count = await this.redis.incr(this.key)

    if (count === 1) {
      await this.redis.expire(this.key, rate || THRESHOLD)
    }

    return count
  }

  async limit(removeFromCache = true): Promise<boolean> {
    let count = Number.parseInt(await this.redis.get(this.key))

    for (const instance of this.externalRedis) {
      count += Number.parseInt(await instance.get(this.key))
    }

    const remove = count > RATE_LIMIT

    if (removeFromCache) {
      await this.redis.del(this.key)

      const operations = []

      for (const instance of this.externalRedis) {
        operations.push(instance.del(this.key))
      }

      // Don't need to explicitly need for the other instances to update
      Promise.allSettled(operations).catch((error) =>
        logger.log('error', 'Error saving rate limit across regions', { error })
      )
    }

    return remove
  }
}
