import { Redis } from 'ioredis'
import NodeCache from 'node-cache'

// Cache performs cache operations using tiered Caching with ioredis and node-cache
export class Cache {
  redis: Redis
  local: NodeCache

  constructor(redis: Redis) {
    this.redis = redis
    this.local = new NodeCache({
      checkperiod: 60,
      useClones: true,
      deleteOnExpire: true,
    })
  }

  async set(key: string, value: string | number, ttlType: 'KEEPTTL' | 'EX', ttlSeconds?: number): Promise<string> {
    if (ttlType === 'KEEPTTL') {
      this.local.set<string | number>(key, value, this.getLocalTTL(key))
      return this.redis.set(key, value, ttlType)
    }

    this.local.set<string | number>(key, value, ttlSeconds)
    return this.redis.set(key, value, ttlType, ttlSeconds)
  }

  async get(key: string): Promise<string | null> {
    const value = this.local.get<string>(key)
    return value ? value : this.getRedisToSetLocal(key)
  }

  async mget(...keys: string[]): Promise<string[]> {
    const localValues: string[] = []

    Object.entries(this.local.mget<string>(keys)).forEach(([_, value]) => {
      if (typeof value === 'string') {
        localValues.push(value)
      }
    })

    return localValues.length === keys.length ? localValues : this.mgetRedisToSetLocal(...keys)
  }

  async sadd(key: string, ...values: string[]): Promise<number> {
    const localValue = this.local.get<string>(key)
    const ttl = this.getLocalTTL(key)

    if (localValue) {
      this.local.set(key, JSON.stringify([...new Set([...JSON.parse(localValue), ...values])]), ttl)
    } else {
      this.local.set(key, JSON.stringify([...new Set(values)]))
    }

    return this.redis.sadd(key, values)
  }

  async smembers(key: string): Promise<string[]> {
    const value = this.local.get<string>(key)

    if (value) {
      const parsedValue = JSON.parse(value)
      if (Array.isArray(parsedValue)) {
        return parsedValue
      }
    }

    return this.redis.smembers(key)
  }

  async ttl(key: string): Promise<number> {
    const localTTL = this.local.getTtl(key) || 0
    return localTTL ? this.getLocalTTL(key) : this.redis.ttl(key)
  }

  async expire(key: string, ttlSeconds: number) {
    this.local.ttl(key, ttlSeconds)
    return this.redis.expire(key, ttlSeconds)
  }

  async del(...keys: string[]): Promise<number> {
    this.local.del(keys)
    return this.redis.del(...keys)
  }

  async llen(key: string): Promise<number> {
    const value = this.local.get<string>(key)

    if (value && Array.isArray(JSON.parse(value))) {
      return value.length
    }

    return this.redis.llen(key)
  }

  async incr(key: string): Promise<number> {
    const value = await this.redis.incr(key)
    this.local.set(key, value)

    return value
  }

  async flushall(): Promise<string> {
    this.local.flushAll()
    return this.redis.flushall()
  }

  private async getRedisToSetLocal(key: string): Promise<string> {
    const redisValue = await this.redis.get(key)
    if (redisValue) {
      const ttl = await this.redis.ttl(key)
      this.local.set(key, redisValue, ttl)
    }
    return redisValue
  }

  private async mgetRedisToSetLocal(...keys: string[]): Promise<string[]> {
    const values = await this.redis.mget(keys)

    for (let i = 0; i < values.length; i++) {
      if (values[i] === null) {
        continue
      }
      const ttl = await this.redis.ttl(keys[i])
      this.local.set(keys[i], values[i], ttl)
    }
    return values
  }

  private getLocalTTL(key: string) {
    const localTTL = this.local.getTtl(key) || 0
    // Gets time difference in seconds
    return localTTL > 0 ? localTTL : (localTTL - new Date().getTime()) / 1000
  }
}
