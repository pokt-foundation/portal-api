import axios, { AxiosRequestConfig } from 'axios'
import jsonrpc, { ErrorObject } from 'jsonrpc-lite'
import { blockHexToDecimal } from '../block'

const logger = require('../../services/logger')

export async function enforceGetLogs(
  rpcID: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsedRawData: Record<string, any>,
  blockchainID: string,
  requestID: string,
  logLimitBlocks: number,
  altruistURL: string
): Promise<ErrorObject | undefined> {
  let toBlock: number
  let fromBlock: number
  const [{ fromBlock: fromBlockParam, toBlock: toBlockParam }] = parsedRawData.params as [
    { fromBlock: string; toBlock: string }
  ]

  if (toBlockParam !== undefined && toBlockParam !== 'latest') {
    toBlock = blockHexToDecimal(toBlockParam)
  }
  if (fromBlockParam !== undefined && fromBlockParam !== 'latest') {
    fromBlock = blockHexToDecimal(fromBlockParam)
  }

  // If any of the blocks is 'latest', we check altruists for latest height.
  if (isNaN(toBlock) || isNaN(fromBlock)) {
    // TODO: use a generic getHeightFromAltruist function to fetch altruist block height
    const rawData = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber' })

    try {
      const axiosConfig = {
        method: 'POST',
        url: altruistURL,
        data: rawData,
        headers: { 'Content-Type': 'application/json' },
      } as AxiosRequestConfig

      const { data } = await axios(axiosConfig)

      const latestBlock = blockHexToDecimal(data.result)

      if (isNaN(toBlock)) {
        toBlock = latestBlock
      }

      if (isNaN(fromBlock)) {
        fromBlock = latestBlock
      }
    } catch (e) {
      logger.log('error', `Altruist is not responding: ${altruistURL.replace(/[\w]*:\/\/[^\/]*@/g, '')}`, {
        blockchainID,
        requestID,
      })
    }
  }

  if (toBlock - fromBlock > logLimitBlocks) {
    return jsonrpc.error(
      rpcID,
      new jsonrpc.JsonRpcError(`You cannot query logs for more than ${logLimitBlocks} blocks at once.`, -32064)
    ) as ErrorObject
  }
}
