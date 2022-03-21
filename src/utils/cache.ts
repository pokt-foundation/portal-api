import { Node } from '@pokt-foundation/pocketjs-types'
import axios, { AxiosError } from 'axios'
import extractDomain from 'extract-domain'
import { Redis } from 'ioredis'
import { getAddressFromPublicKey } from 'pocket-tools'

const logger = require('../services/logger')

const POCKET_NETWORK_NODE_URL = String(process.env.POCKET_NETWORK_NODE_URL)

/**
 * Removes node from cached session, following calls within the same session,
 * also cleans the chain/sync check cache to prevent using invalid nodes
 * @param redis cache service to use
 * @param blockchainID blockchain where session resides
 * @param nodes session nodes
 * @param nodePubKey node to remove's public key
 * @returns
 */
export async function removeNodeFromSession(
  redis: Redis,
  sessionkey: string,
  nodes: Node[],
  nodePubKey: string,
  removeChecksFromCache = false,
  requestID?: string,
  blockchainID?: string
): Promise<void> {
  const sessionKey = `session-key-${sessionkey}`

  await redis.sadd(sessionKey, nodePubKey)
  const nodesToRemoveTTL = await redis.ttl(sessionKey)

  if (nodesToRemoveTTL < 0) {
    await redis.expire(sessionKey, 3600) // 1 hour
  }

  /*
  RE-ENABLE LOGS to check which nodes are getting removed
  */
  logger.warn('info', 'Exhausted node removed', {
    sessionKey,
    serviceNode: nodePubKey,
    requestID,
    blockchainID,
  })

  if (removeChecksFromCache) {
    await removeChecksCache(redis, sessionKey, nodes)
  }
}
/**
 * Retrieves node network information
 * @param redis cache service to use
 * @param publicKey node's public key
 * @param requestID (optional) request identifier, for logging
 * @returns
 */
export async function getNodeNetworkData(redis: Redis, publicKey: string, requestID?: string): Promise<NodeURLInfo> {
  let nodeUrl: NodeURLInfo = { serviceURL: '', serviceDomain: '' }

  // Might come empty or undefined on relay failure
  // TODO: FIND Better way to check for valid service nodes (public key)
  if (!publicKey || publicKey.length !== 64) {
    return nodeUrl
  }

  const address = await getAddressFromPublicKey(publicKey)
  const nodeCached = await redis.get(`node-${publicKey}`)

  if (nodeCached) {
    nodeUrl = JSON.parse(nodeCached)
    return nodeUrl
  }

  try {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { service_url } = (await axios.post(`${POCKET_NETWORK_NODE_URL}/v1/query/node`, { address })).data

    nodeUrl = { serviceURL: service_url, serviceDomain: extractDomain(service_url) }

    await redis.set(`node-${publicKey}`, JSON.stringify(nodeUrl), 'EX', 60 * 60 * 6) // 6 hours
  } catch (e) {
    logger.log('warn', `Failure getting node network data: ${(e as AxiosError).message}`, {
      serviceNode: publicKey,
      requestID,
    })
  }

  return nodeUrl
}

export async function removeSessionCache(redis: Redis, publicKey: string, blockchainID: string): Promise<void> {
  await redis.del(`session-cached-${publicKey}-${blockchainID}`)
}

type NodeURLInfo = {
  serviceURL: string
  serviceDomain: string
}

export async function removeChecksCache(redis: Redis, sessionKey: string, nodes: Node[]) {
  await redis.del(`sync-check-${sessionKey}`)
  await redis.del(`chain-check-${sessionKey}`)
}
