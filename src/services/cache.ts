import { Redis } from 'ioredis'
import NodeCache from 'node-cache'

type AllowedKeyTyes = string | number

// Cache performs cache operations using tiered Caching with ioredis and node-cache
export class Cache {
  redis: Redis
  local: NodeCache

  constructor(redis: Redis) {
    this.redis = redis
    this.local = new NodeCache({
      checkperiod: 120,
      useClones: true,
      deleteOnExpire: true,
    })
  }

  async set(key: string, value: string | number, ttlSeconds: number): Promise<boolean> {
    await this.redis.set(key, value, 'EX', ttlSeconds)

    return this.local.set<AllowedKeyTyes>(key, value, ttlSeconds)
  }

  async get(key: string): Promise<AllowedKeyTyes | null> {
    const value = this.local.get<AllowedKeyTyes>(key)
    return value ? value : this.redis.get(key)
  }

  async mget(...keys: string[]): Promise<string[]> {
    const localValues: string[] = []

    Object.entries(this.local.mget<string>(keys)).forEach(([_, value]) => {
      if (typeof value === 'string') {
        localValues.push(value)
      }
    })

    return localValues.length === keys.length ? localValues : this.redis.mget(keys)
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
    const localTTL = this.local.getTtl(key)

    return localTTL ? localTTL : this.redis.ttl(key)
  }

  async expire(key: string, ttlSeconds: number) {
    this.local.ttl(key, ttlSeconds)

    return this.redis.expire(key, ttlSeconds)
  }
}
