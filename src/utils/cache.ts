import { Redis } from 'ioredis'
import { Node } from '@pokt-network/pocket-js'
import { getAddressFromPublicKey } from 'pocket-tools'
import axios, { AxiosError } from 'axios'

const logger = require('../services/logger')

const ALTRUIST_URL = JSON.parse(process.env.ALTRUISTS)?.['0001']

/**
 * Removes node from cached session, following calls within the same session,
 * also cleans the chain/sync check cache to prevent using invalid nodes
 * @param redis cache service to use
 * @param sessionKey session key
 * @param nodePubKey node to remove's public key
 * @returns
 */
export async function removeNodeFromSession(redis: Redis, sessionKey: string, nodePubKey: string): Promise<void> {
  await redis.sadd(`session-${sessionKey}`, nodePubKey)
  await redis.del(`sync-check-${sessionKey}`, `chain-check-${sessionKey}`)
}

export async function getNodeNetworkData(redis: Redis, publicKey: string, requestID?: string): Promise<NodeURLInfo> {
  const address = await getAddressFromPublicKey(publicKey)

  let node: NodeURLInfo = { serviceURL: '', serviceDomain: '' }

  const nodeCached = await redis.get(`node-${publicKey}`)

  if (nodeCached) {
    node = JSON.parse(nodeCached)
    return node
  }

  try {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { service_url } = (await axios.post(`${ALTRUIST_URL}/v1/query/node`, { address })).data

    node = { serviceURL: service_url, serviceDomain: new URL(service_url).hostname.replace('www.', '') }

    await redis.set(`node-${publicKey}`, JSON.stringify(node), 'EX', 60 * 60 * 6) // 6 hours
  } catch (e) {
    logger.log('warn', `Failure getting node network data: ${(e as AxiosError).message}`, {
      serviceNode: publicKey,
      requestID,
    })
  }

  return node
}

type NodeURLInfo = {
  serviceURL: string
  serviceDomain: string
}
