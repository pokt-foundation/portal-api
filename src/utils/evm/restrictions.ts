import jsonrpc, { ErrorObject } from 'jsonrpc-lite'
import { Applications } from '../../models'
import { WS_ONLY_METHODS } from '../constants'
import { parseMethod } from '../parsing'
import { enforceGetLogs } from './get-logs'
import { enforceContractWhitelist, enforceMethodWhitelist } from './whitelist'

export async function enforceEVMRestrictions(
  application: Applications,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsedRawData: Record<string, any>,
  blockchainID: string,
  requestID: string,
  rpcID: number,
  logLimitBlocks: number,
  altruistUrl: string
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
  } else if (application?.gatewaySettings?.whitelistMethods?.length > 0) {
    return enforceMethodWhitelist(rpcID, method, application?.gatewaySettings?.whitelistMethods)
  } else if (application?.gatewaySettings?.whitelistContracts?.length > 0) {
    return enforceContractWhitelist(rpcID, parsedRawData, application?.gatewaySettings?.whitelistContracts)
  } else if (method === 'eth_getLogs') {
    return enforceGetLogs(rpcID, parsedRawData, blockchainID, requestID, logLimitBlocks, altruistUrl)
  }
}
