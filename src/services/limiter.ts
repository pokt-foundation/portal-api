import axios from 'axios'
import { JSONObject } from '@loopback/context'
import { HttpErrors } from '@loopback/rest'
import { LimitError } from '../errors/types'
import { blockHexToDecimal } from '../utils/block'
import { WS_ONLY_METHODS } from '../utils/constants'

const logger = require('../services/logger')

export async function enforceEVMLimits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsedRawData: Record<string, any>,
  blockchainID: string,
  logLimitBlocks: number,
  altruists: JSONObject
): Promise<void | Error> {
  if (WS_ONLY_METHODS.includes(parsedRawData.method)) {
    return new HttpErrors.BadRequest(
      `We cannot serve ${parsedRawData.method} method over HTTPS. At the moment, we do not support WebSockets.`
    )
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

      let axiosConfig = {}

      try {
        axiosConfig = {
          method: 'POST',
          url: altruistUrl,
          data: rawData,
          headers: { 'Content-Type': 'application/json' },
        }
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
        return new HttpErrors.InternalServerError('Internal error. Try again with a explicit block number.')
      }
    } else {
      // We cannot move forward if there is no altruist available.
      if (!isToBlockHex || !isFromBlockHex) {
        return new LimitError(`Please use an explicit block number instead of 'latest'.`, parsedRawData.method)
      }
    }
    if (toBlock - fromBlock > logLimitBlocks) {
      return new LimitError(
        `You cannot query logs for more than ${logLimitBlocks} blocks at once.`,
        parsedRawData.method
      )
    }
  }
}
