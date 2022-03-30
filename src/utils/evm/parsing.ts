import { utils } from 'ethers'
import { parseMethod } from '../parsing'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractContractAddress(rawData: Record<string, any>): string | undefined {
  const [firstParameter] = rawData.params
  const method = parseMethod(rawData)

  switch (method) {
    case 'eth_sendRawTransaction':
      return decodeEthRawTxAddress(firstParameter)
    case 'eth_call':
      // firstParameter is the raw tx hex
      return firstParameter?.to
    case 'eth_getLogs':
      return firstParameter?.address
    case 'eth_getCode':
    case 'eth_getBalance':
    case 'eth_getStorageAt':
    case 'eth_getTransactionCount':
      // firstParameter is the address
      return firstParameter
    default:
      // If the method is not supported, return undefined
      return undefined
  }
}

export function decodeEthRawTxAddress(rawTxBytes: string): string {
  const decodedTx = utils.RLP.decode(rawTxBytes)

  const [
    ,
    ,
    ,
    // rawNonce
    // rawGasPrice
    // rawGasLimit
    rawTo,
  ] = decodedTx

  return rawTo
}
