import { Redis } from 'ioredis'

// Cache performs cache operations using tiered Caching with ioredis
export class Cache {
  remote: Redis
  local: Redis

  constructor(remoteRedis: Redis, localRedis: Redis) {
    this.remote = remoteRedis
    this.local = localRedis
  }

  async set(key: string, value: string, ttlType: 'KEEPTTL' | 'EX', ttlSeconds?: number): Promise<string> {
    if (ttlType === 'KEEPTTL') {
      const ttl = await this.local.ttl(key)
      await this.local.set(key, value, 'EX', ttl)
      return this.remote.set(key, value, ttlType)
    }

    await this.local.set(key, value, ttlType, ttlSeconds)
    return this.remote.set(key, value, ttlType, ttlSeconds)
  }

  async get(key: string): Promise<string | null> {
    const value = await this.local.get(key)
    return value ? value : this.getRedisToSetLocal(key)
  }

  async mget(...keys: string[]): Promise<string[]> {
    const localValues: string[] = []

    Object.entries(this.local.mget(keys)).forEach(([_, value]) => {
      if (typeof value === 'string') {
        localValues.push(value)
      }
    })

    return localValues.length === keys.length ? localValues : this.mgetRedisToSetLocal(...keys)
  }

  async sadd(key: string, ...values: string[]): Promise<number> {
    const localValue = await this.local.get(key)

    if (localValue) {
      const ttl = await this.local.ttl(key)
      return this.local.sadd(key, JSON.stringify([...new Set([...JSON.parse(localValue), ...values])]), 'EX', ttl)
    }

    await this.local.sadd(key, JSON.stringify([...new Set(values)]))
    return this.remote.sadd(key, values)
  }

  async smembers(key: string): Promise<string[]> {
    const value = await this.local.get(key)

    if (value) {
      const parsedValue = Array.from(value)
      if (Array.isArray(parsedValue)) {
        return parsedValue
      }
    }

    return this.remote.smembers(key)
  }

  async ttl(key: string): Promise<number> {
    const localTTL = (await this.local.ttl(key)) || 0
    return localTTL ? localTTL : this.remote.ttl(key)
  }

  async expire(key: string, ttlSeconds: number) {
    await this.local.expire(key, ttlSeconds)
    return this.remote.expire(key, ttlSeconds)
  }

  async del(...keys: string[]): Promise<number> {
    await this.local.del(keys)
    return this.remote.del(...keys)
  }

  async llen(key: string): Promise<number> {
    const value = await this.local.get(key)

    if (value) {
      const parsedValue = JSON.parse(value)
      if (Array.isArray(parsedValue)) {
        return parsedValue.length
      }
    }

    return this.remote.llen(key)
  }

  async incr(key: string): Promise<number> {
    const value = await this.remote.incr(key)
    await this.local.set(key, value)

    return value
  }

  async flushall(): Promise<string> {
    await this.local.flushall()
    return this.remote.flushall()
  }

  private async getRedisToSetLocal(key: string): Promise<string> {
    const redisValue = await this.remote.get(key)
    if (redisValue) {
      const ttl = await this.remote.ttl(key)
      await this.local.set(key, redisValue, 'EX', ttl)
    }
    return redisValue
  }

  private async mgetRedisToSetLocal(...keys: string[]): Promise<string[]> {
    const values = await this.remote.mget(keys)

    for (let i = 0; i < values.length; i++) {
      if (values[i] === null) {
        continue
      }
      const ttl = await this.remote.ttl(keys[i])
      await this.local.set(keys[i], values[i], 'EX', ttl)
    }
    return values
  }
}
