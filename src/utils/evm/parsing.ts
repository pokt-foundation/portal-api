import { utils } from 'ethers'
import { parseMethod } from '../parsing'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractContractAddress(rawData: Record<string, any>): string | undefined {
  const params = rawData.params
  const method = parseMethod(rawData)

  switch (method) {
    case 'eth_sendRawTransaction':
      return decodeEthRawTxAddress(params[0])
    case 'eth_call':
      // firstParameter is the raw tx hex
      return params[0]?.to
    case 'eth_getLogs':
      return params[0]?.address
    case 'eth_getCode':
    case 'eth_getBalance':
    case 'eth_getStorageAt':
    case 'eth_getTransactionCount':
      // firstParameter is the address
      return params[0]
    default:
      // If the method is not supported, return undefined
      return undefined
  }
}

export function decodeEthRawTxAddress(rawTxBytes: string): string {
  let type = 'Legacy'
  // Fix for parsing EIP1559: see below link for more details
  // https://github.com/ethers-io/ethers.js/discussions/3269
  if (rawTxBytes.substring(0, 4) === '0x02') {
    rawTxBytes = rawTxBytes.substring(0, 2) + rawTxBytes.substring(4)
    type = 'EIP1559'
  } else if (rawTxBytes.substring(0, 2) === '02') {
    rawTxBytes = rawTxBytes.substring(2)
    type = 'EIP1559'
  }

  const decodedTx = utils.RLP.decode(rawTxBytes)

  if (type !== 'EIP1559') {
    return decodedTx[3]
  }

  // in case of EIP1559, the 'to address' is on index 5
  return decodedTx[5]
}
