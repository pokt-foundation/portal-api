import { Redis } from 'ioredis'

/**
 * Removes node from cached session, following calls within the same session,
 * also cleans the chain/sync check cache
 * should not be used
 * @param redis cache service to use
 * @param sessionKey session key
 * @param nodePubKey node to remove's public key
 * @returns
 */
export async function removeNodeFromSession(redis: Redis, sessionKey: string, nodePubKey: string): Promise<void> {
  await redis.sadd(`session-${sessionKey}`, nodePubKey)

  await redis.del(`sync-check-${sessionKey}`, `chain-check-${sessionKey}`)
}
