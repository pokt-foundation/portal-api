import axios, { AxiosRequestConfig } from 'axios'
import jsonrpc, { ErrorObject } from 'jsonrpc-lite'
import { JSONObject } from '@loopback/context'
import { blockHexToDecimal } from '../utils/block'
import { WS_ONLY_METHODS } from '../utils/constants'
import { parseRPCID } from '../utils/parsing'

const logger = require('../services/logger')

export async function enforceEVMLimits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsedRawData: Record<string, any>,
  blockchainID: string,
  logLimitBlocks: number,
  altruists: JSONObject
): Promise<void | ErrorObject> {
  const rpcID = parseRPCID(parsedRawData)

  if (WS_ONLY_METHODS.includes(parsedRawData.method)) {
    return jsonrpc.error(
      rpcID,
      new jsonrpc.JsonRpcError(
        `${parsedRawData.method} method cannot be served over HTTPS. WebSockets are not supported at the moment.`,
        -32053
      )
    ) as ErrorObject
  } else if (parsedRawData.method === 'eth_getLogs') {
    let toBlock: number
    let fromBlock: number
    let isToBlockHex = false
    let isFromBlockHex = false
    const altruistUrl = String(altruists[blockchainID])
    const [{ fromBlock: fromBlockParam, toBlock: toBlockParam }] = parsedRawData.params as [
      { fromBlock: string; toBlock: string }
    ]

    if (toBlockParam !== undefined && toBlockParam !== 'latest') {
      toBlock = blockHexToDecimal(toBlockParam)
      isToBlockHex = true
    }
    if (fromBlockParam !== undefined && fromBlockParam !== 'latest') {
      fromBlock = blockHexToDecimal(fromBlockParam)
      isFromBlockHex = true
    }

    if ((toBlock !== 0 || fromBlock !== 0) && altruistUrl !== 'undefined') {
      // Altruist
      // TODO: use a generic getHeightFromAltruist function to fetch altruist block height
      const rawData = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] })

      try {
        const axiosConfig = {
          method: 'POST',
          url: altruistUrl,
          data: rawData,
          headers: { 'Content-Type': 'application/json' },
        } as AxiosRequestConfig

        const { data } = await axios(axiosConfig)

        const latestBlock = blockHexToDecimal(data.result)

        if (!isToBlockHex) {
          toBlock = latestBlock
        }
        if (!isFromBlockHex) {
          fromBlock = latestBlock
        }
      } catch (e) {
        logger.log('error', `Failed trying to reach altruist (${altruistUrl}) to fetch block number.`)
        return jsonrpc.error(
          rpcID,
          new jsonrpc.JsonRpcError('Try again with a explicit block number.', -32062)
        ) as ErrorObject
      }
    } else {
      // We cannot move forward if there is no altruist available.
      if (!isToBlockHex || !isFromBlockHex) {
        return jsonrpc.error(
          rpcID,
          new jsonrpc.JsonRpcError(`Please use an explicit block number instead of 'latest'.`, -32063)
        ) as ErrorObject
      }
    }
    if (toBlock - fromBlock > logLimitBlocks) {
      return jsonrpc.error(
        rpcID,
        new jsonrpc.JsonRpcError(`You cannot query logs for more than ${logLimitBlocks} blocks at once.`, -32064)
      ) as ErrorObject
    }
  }
}
