import { Node } from '@pokt-network/pocket-js'
import { Redis } from 'ioredis'
import PQueue from 'p-queue'

const logger = require('../services/logger')

const queue = new PQueue({ concurrency: 1 })

/**
 * Removes node from cached session, following calls within the same session
 * should not be used
 * @param redis cache service to use
 * @param sessionKey session key
 * @param node node to remove
 * @returns
 */
export async function removeNodeFromSession(redis: Redis, sessionKey: string, node: Node): Promise<void> {
  const operation = async () => {
    const cachedNodes = await redis.get(`session-${sessionKey}`)

    // This should not happen as session cache should be created on pocket-relayer
    // service before using this function, usage of this function outside relaying
    // context does not make sense, won't have any effect and is thereby discouraged
    if (!cachedNodes) {
      logger.log(
        'warn',
        `attempting to remove node from uncached session. SessionKey: ${sessionKey}, node public key: ${node.publicKey}`
      )
      return
    }

    const nodes: string[] = JSON.parse(cachedNodes)

    if (nodes.includes(node.publicKey)) {
      return
    }

    nodes.push(node.publicKey)
    await redis.set(`session-nodes-${sessionKey}`, JSON.stringify(nodes), 'KEEPTTL')
  }

  // Prevent write clashes in case multiple nodes fail at the same time
  await queue.add(() => operation())
}
