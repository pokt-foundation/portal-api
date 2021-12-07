import { Redis } from 'ioredis'

const DEFAULT_RELAYS_LIMIT = 7 // relays per second
const DEFAULT_DURATION = 5 // seconds

const logger = require('./logger')

export class RateLimiter {
  redis: Redis
  externalRedis: Redis[]
  key: string
  limiter: number
  duration: number

  constructor(key: string, redis: Redis, externalRedis: Redis[], limit?: number, duration?: number) {
    this.key = key
    this.redis = redis
    this.externalRedis = externalRedis

    this.limiter = limit || DEFAULT_RELAYS_LIMIT
    this.duration = duration || DEFAULT_DURATION
  }

  async increase(): Promise<number> {
    const count = await this.redis.incr(this.key)

    if (count === 1) {
      await this.redis.expire(this.key, this.duration)
    }

    return count
  }

  async limit(increase = false): Promise<boolean> {
    let count = increase ? await this.increase() : Number.parseInt(await this.redis.get(this.key))

    for (const instance of this.externalRedis) {
      count += Number.parseInt(await instance.get(this.key))
    }

    const remove = count > this.limiter

    return remove
  }

  async remove(externalRedis: boolean, ...additionalKeys: string[]): Promise<void> {
    await this.redis.del(this.key, ...additionalKeys)

    const operations = []

    if (externalRedis) {
      for (const instance of this.externalRedis) {
        operations.push(instance.del(this.key, ...additionalKeys))
      }
    }

    // Don't need to explicitly wait for the other instances to update
    Promise.allSettled(operations).catch((error) =>
      logger.log('error', 'Error saving rate limit across regions', { error })
    )
  }
}
