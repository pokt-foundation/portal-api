import jsonrpc, { ErrorObject } from 'jsonrpc-lite'
import { checkWhitelist } from '../enforcements'
import { extractContractAddress } from './parsing'

export function enforceMethodWhitelist(rpcID: number, method: string, whitelistedMethods: string[]) {
  if (!checkWhitelist(whitelistedMethods, method, 'explicit')) {
    return jsonrpc.error(rpcID, new jsonrpc.JsonRpcError('Restricted endpoint: method not allowed.', 0)) as ErrorObject
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function enforceContractWhitelist(rpcID: number, rawData: Record<string, any>, whitelistedContracts: string[]) {
  const contractAddress = extractContractAddress(rawData)

  if (!contractAddress) {
    return
  }

  if (!checkWhitelist(whitelistedContracts, contractAddress, 'explicit')) {
    return jsonrpc.error(
      rpcID,
      new jsonrpc.JsonRpcError('Restricted endpoint: contract address not allowed.', 0)
    ) as ErrorObject
  }
}
