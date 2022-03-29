import { Redis } from 'ioredis'

// Cache performs cache operations using tiered Caching with ioredis
export class Cache {
  remote: Redis
  local: Redis

  constructor(remoteRedis: Redis, localRedis: Redis) {
    this.remote = remoteRedis
    this.local = localRedis
  }

  async set(key: string, value: string, ttlType: string, ttlSeconds?: number): Promise<string> {
    await this.local.set(key, value, ttlType, ttlSeconds)
    return this.remote.set(key, value, ttlType, ttlSeconds)
  }

  async get(key: string): Promise<string | null> {
    const value = await this.local.get(key)
    return value ? value : this.getRedisToSetLocal(key)
  }

  async mget(...keys: string[]): Promise<string[]> {
    let valid = true
    const localValues: string[] = await this.local.mget(keys)

    for (const value of localValues) {
      if (!value) {
        valid = false
        break
      }
    }

    return valid ? localValues : this.mgetRedisToSetLocal(...keys)
  }

  async sadd(key: string, ...values: string[]): Promise<number> {
    await this.local.sadd(key, ...values)
    return this.remote.sadd(key, ...values)
  }

  async smembers(key: string): Promise<string[]> {
    const value = await this.local.smembers(key)

    if (value.length > 0) {
      return value
    }

    return this.remote.smembers(key)
  }

  async ttl(key: string): Promise<number> {
    const localTTL = await this.local.ttl(key)
    return localTTL > 0 ? localTTL : this.remote.ttl(key)
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
    const value = await this.local.llen(key)

    if (value > 0) {
      return value
    }

    return this.remote.llen(key)
  }

  async incr(key: string): Promise<number> {
    return this.remote.incr(key)
  }

  async flushall(): Promise<string> {
    await this.local.flushall()
    return this.remote.flushall()
  }

  private async getRedisToSetLocal(key: string): Promise<string> {
    const redisValue = await this.remote.get(key)
    if (redisValue) {
      const ttl = await this.remote.ttl(key)

      await this.local.set(key, redisValue, 'EX', ttl > 0 ? ttl : 60)
    }
    return redisValue
  }

  private async mgetRedisToSetLocal(...keys: string[]): Promise<string[]> {
    const values = await this.remote.mget(keys)

    for (let i = 0; i < values.length; i++) {
      if (!values[i]) {
        continue
      }
      const ttl = await this.remote.ttl(keys[i])

      await this.local.set(keys[i], values[i], 'EX', ttl > 0 ? ttl : 60)
    }
    return values
  }
}
