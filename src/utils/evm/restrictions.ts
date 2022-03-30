import jsonrpc, { ErrorObject } from 'jsonrpc-lite'
import { Applications } from '../../models'
import { WS_ONLY_METHODS } from '../constants'
import { parseMethod } from '../parsing'
import { enforceGetLogs } from './get-logs'
import { isContractWhitelisted, isMethodWhitelisted } from './whitelist'

export async function enforceEVMRestrictions(
  application: Applications,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsedRawData: Record<string, any>,
  blockchainID: string,
  requestID: string,
  rpcID: number,
  logLimitBlocks: number,
  altruistURL: string
): Promise<ErrorObject | void> {
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

  if (application?.gatewaySettings?.whitelistMethods?.length > 0) {
    const restriction = application.gatewaySettings.whitelistMethods.find((x) => x.blockchainID === blockchainID)

    const enforced = isMethodWhitelisted(method, restriction.methods)

    if (!enforced) {
      return
    }

    return jsonrpc.error(rpcID, new jsonrpc.JsonRpcError('Restricted endpoint: method not allowed.', 0)) as ErrorObject
  }

  if (application?.gatewaySettings?.whitelistContracts?.length > 0) {
    const restriction = application.gatewaySettings.whitelistContracts.find((x) => x.blockchainID === blockchainID)

    const enforced = isContractWhitelisted(parsedRawData, restriction.contracts)

    if (!enforced) {
      return
    }

    return jsonrpc.error(
      rpcID,
      new jsonrpc.JsonRpcError('Restricted endpoint: contract address not allowed.', 0)
    ) as ErrorObject
  }

  if (method === 'eth_getLogs') {
    return enforceGetLogs(rpcID, parsedRawData, blockchainID, requestID, logLimitBlocks, altruistURL)
  }
}
