import { utils } from 'ethers'
import { parseMethod } from '../parsing'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractContractAddress(rawData: Record<string, any>): { fromAddress: string; toAddress: string } {
  const params = rawData.params !== undefined ? rawData.params : {}
  const method = parseMethod(rawData)

  switch (method) {
    case 'eth_sendRawTransaction':
      return decodeEthRawTxAddress(params[0])
    case 'eth_call':
      // firstParameter is the raw tx hex
      return { toAddress: params[0]?.to, fromAddress: undefined }
    case 'eth_getLogs':
      return { toAddress: params[0]?.address, fromAddress: undefined }
    case 'eth_getCode':
    case 'eth_getBalance':
    case 'eth_getStorageAt':
    case 'eth_getTransactionCount':
      // firstParameter is the address
      return { toAddress: params[0], fromAddress: undefined }
    default:
      return { toAddress: undefined, fromAddress: undefined }
  }
}

export function decodeEthRawTxAddress(rawTxBytes: string): { fromAddress: string; toAddress: string } {
  const { from: fromAddress, to: toAddress } = utils.parseTransaction(rawTxBytes)

  return { fromAddress, toAddress }
}
