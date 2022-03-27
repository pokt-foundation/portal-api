import { Redis, Cluster } from 'ioredis'
import NodeCache from 'node-cache'

type AllowedKeyTyes = string | number

// Cache performs cache operations using tiered Caching with ioredis and node-cache
export class Cache {
  redis: Redis | Cluster
  local: NodeCache

  constructor(redis: Redis | Cluster) {
    this.redis = redis
    this.local = new NodeCache({
      checkperiod: 120,
      useClones: true,
      deleteOnExpire: true,
    })
  }

  async set(key: string, value: string | number, ttlType: 'KEEPTTL' | 'EX', ttlSeconds?: number): Promise<string> {
    if (ttlType === 'KEEPTTL') {
      this.local.set<AllowedKeyTyes>(key, value, this.getLocalTTL(key))
      return this.redis.set(key, value, ttlType)
    }

    this.local.set<AllowedKeyTyes>(key, value, ttlSeconds)
    return this.redis.set(key, value, ttlType, ttlSeconds)
  }

  async get(key: string): Promise<AllowedKeyTyes | null> {
    const value = this.local.get<AllowedKeyTyes>(key)
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
    const ttl = this.local.getTtl(key)

    const set = [...new Set(values)]

    if (localValue) {
      this.local.set(key, JSON.stringify([...JSON.parse(localValue), ...set]), ttl)
    } else {
      this.local.set(key, JSON.stringify(set))
    }

    return this.redis.sadd(key)
  }

  async smembers(key: string): Promise<string[]> {
    const value = this.local.get<string>(key)
    return value ? JSON.parse(value) : this.redis.smembers(key)
  }

  async ttl(key: string): Promise<number> {
    let localTTL = this.local.getTtl(key) || 0

    // localTTL returns a timestamp of when the key is going to expire
    if (localTTL > 0) {
      // Gets time difference in seconds
      localTTL = (localTTL - new Date().getTime()) / 1000
    }

    return localTTL ? localTTL : this.redis.ttl(key)
  }

  async expire(key: string, ttlSeconds: number) {
    this.local.ttl(key, ttlSeconds)

    return this.redis.expire(key, ttlSeconds)
  }

  async del(...keys: string[]): Promise<number> {
    this.local.del(keys)

    return this.redis.del(...keys)
  }

  async getRedisToSetLocal(key: string): Promise<string> {
    const redisValue = await this.redis.get(key)
    if (redisValue) {
      const ttl = await this.redis.ttl(key)
      this.local.set(key, redisValue, ttl)
    }
    return redisValue
  }

  async mgetRedisToSetLocal(...keys: string[]): Promise<string[]> {
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

  getLocalTTL(key: string) {
    const localTTL = this.local.getTtl(key) || 0
    // Gets time difference in seconds
    return localTTL > 0 ? localTTL : (localTTL - new Date().getTime()) / 1000
  }
}
