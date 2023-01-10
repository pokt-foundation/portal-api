import axios from 'axios'
import { Cache } from '../../services/cache'
import { parseMethod, parseRawData } from '../parsing'

const routes = {
  getMethods: '/relay/methods',
  verifyRelay: '/relay/verify',
}
const methodsKey = 'relay-security-methods'

export type RelayCheck = {
  applicationID: string
  blockchainID: string
  applicationPublicKey: string
  sessionKey: string
  nodePublicKey: string
  request: string
  response: string
  altruist: string
  blockHeightRequest: string
  syncCheckThreshold: number
}

export async function sendRelayForVerification(relaySecurityURL: string, check: RelayCheck, cache: Cache) {
  const methodsToVerify = await getMethodsToVerify(relaySecurityURL, cache)
  const relayMethods = parseMethod(parseRawData(check.request)).split(',')

  let send = false
  for (const method of relayMethods) {
    if (methodsToVerify.includes(method)) {
      send = true
      break
    }
  }

  if (!send) {
    return
  }

  axios({
    method: 'POST',
    url: `${relaySecurityURL}${routes.verifyRelay}`,
    data: check,
  }).catch(function (err) {
    throw err
  })
}

async function getMethodsToVerify(url: string, cache: Cache): Promise<string[]> {
  const cachedMethods = await cache.get(methodsKey)

  if (cachedMethods) {
    return JSON.parse(cachedMethods)
  }

  const { data } = await axios({
    method: 'GET',
    url: `${url}${routes.getMethods}`,
  })

  await cache.set(methodsKey, JSON.stringify(data), 'EX', 600)
  return data
}
