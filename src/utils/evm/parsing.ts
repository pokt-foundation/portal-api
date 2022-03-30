import { ethers } from 'ethers'
import { parseMethod } from '../parsing'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractContractAddress(rawData: Record<string, any>): string | undefined {
  const [firstParameter] = rawData.params
  const method = parseMethod(rawData)

  if (method === 'eth_sendRawTransaction') {
    // firstParameter is the raw tx hex
    return decodeEthRawTxAddress(firstParameter)
  } else if (method === 'eth_call') {
    return firstParameter?.to
  } else if (method === 'eth_getLogs') {
    return firstParameter?.address
  } else if (
    method === 'eth_getCode' ||
    method === 'eth_getBalance' ||
    method === 'eth_getStorageAt' ||
    method === 'eth_getTransactionCount'
  ) {
    // firstParameter is the address
    return firstParameter
  }

  // If the method is not supported, return undefined
  return undefined
}

export function decodeEthRawTxAddress(rawTxBytes: string): string {
  const decodedTx = ethers.utils.RLP.decode(rawTxBytes)

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
