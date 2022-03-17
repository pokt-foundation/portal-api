import axios, { AxiosError } from 'axios'
import extractDomain from 'extract-domain'
import { Redis } from 'ioredis'
import { getAddressFromPublicKey } from 'pocket-tools'
import { Node } from '@pokt-network/pocket-js'
import { hashBlockchainNodes } from './helpers'

const logger = require('../services/logger')

const MAINNET_ALTRUIST_URL = String(process.env.POKT_MAINNET_NODE_URL)

/**
 * Removes node from cached session, following calls within the same session,
 * also cleans the chain/sync check cache to prevent using invalid nodes
 * @param redis cache service to use
 * @param blockchainID blockchain where session resides
 * @param sessionNodes session nodes
 * @param nodePubKey node to remove's public key
 * @returns
 */
export async function removeNodeFromSession(
  redis: Redis,
  blockchainID: string,
  sessionNodes: Node[],
  nodePubKey: string
): Promise<void> {
  const hash = await hashBlockchainNodes(blockchainID, sessionNodes, redis)
  const sessionKey = `session-${hash}`

  await redis.sadd(sessionKey, nodePubKey)
  await redis.del(`sync-check-${hash}`)
  await redis.del(`chain-check-${hash}`)

  const nodesToRemoveTTL = await redis.ttl(sessionKey)

  if (nodesToRemoveTTL < 0) {
    await redis.expire(sessionKey, 3600) // 1 hour
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
    const { service_url } = (await axios.post(`${MAINNET_ALTRUIST_URL}/v1/query/node`, { address })).data

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

type NodeURLInfo = {
  serviceURL: string
  serviceDomain: string
}
