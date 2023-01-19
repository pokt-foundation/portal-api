import jsonrpc, { ErrorObject } from 'jsonrpc-lite'
import { Applications } from '../../models'
import { Cache } from '../../services/cache'
import { getBlockedAddresses } from '../cache'
import { WS_ONLY_METHODS } from '../constants'
import { parseMethod } from '../parsing'
import { enforceGetLogs } from './get-logs'
import { isContractBlocked, isContractWhitelisted, isWhitelisted } from './whitelist'

export async function enforceEVMRestrictions(
  application: Applications,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsedRawData: Record<string, any>,
  blockchainID: string,
  requestID: string,
  rpcID: number,
  logLimitBlocks: number,
  altruistURL: string,
  cache: Cache
): Promise<ErrorObject | undefined> {
  const url = process.env.BLOCKED_ADDRESSES_URL ?? ''
  const blockedAddresses = await getBlockedAddresses(cache.local, url)

  const blocked = isContractBlocked(parsedRawData, blockedAddresses)

  if (blocked) {
    return jsonrpc.error(
      rpcID,
      new jsonrpc.JsonRpcError('Restricted endpoint: contract address not allowed.', 0)
    ) as ErrorObject
  }

  const method = parseMethod(parsedRawData)

  if (WS_ONLY_METHODS.includes(method)) {
    return jsonrpc.error(
      rpcID,
      new jsonrpc.JsonRpcError(
        `${method} method cannot be served over HTTPS. WebSockets are not supported at the moment.`,
        -32053
      )
    ) as ErrorObject
  }

  if (application?.gatewaySettings?.whitelistBlockchains?.length > 0) {
    const enforced = isWhitelisted(blockchainID, application.gatewaySettings.whitelistBlockchains)

    if (!enforced) {
      return jsonrpc.error(
        rpcID,
        new jsonrpc.JsonRpcError('Restricted endpoint: blockchain not allowed.', 0)
      ) as ErrorObject
    }
  }

  if (application?.gatewaySettings?.whitelistMethods?.length > 0) {
    const restriction = application.gatewaySettings.whitelistMethods.find((x) => x.blockchainID === blockchainID)

    const enforced = isWhitelisted(method, restriction?.methods)

    if (!enforced) {
      return jsonrpc.error(
        rpcID,
        new jsonrpc.JsonRpcError('Restricted endpoint: method not allowed.', 0)
      ) as ErrorObject
    }
  }

  if (application?.gatewaySettings?.whitelistContracts?.length > 0) {
    const restriction = application.gatewaySettings.whitelistContracts.find((x) => x.blockchainID === blockchainID)

    const enforced = isContractWhitelisted(parsedRawData, restriction?.contracts)

    if (!enforced) {
      return jsonrpc.error(
        rpcID,
        new jsonrpc.JsonRpcError('Restricted endpoint: contract address not allowed.', 0)
      ) as ErrorObject
    }
  }

  if (method === 'eth_getLogs' && altruistURL) {
    return enforceGetLogs(rpcID, parsedRawData, blockchainID, requestID, logLimitBlocks, altruistURL)
  }

  return undefined
}
