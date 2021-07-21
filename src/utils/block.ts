import { ethers } from 'ethers'

export async function getBlockNumber(providerUrl: string): Promise<number> {
  const provider = new ethers.providers.JsonRpcProvider(providerUrl)
  const latestBlock = await provider.getBlockNumber()

  return latestBlock
}

export function blockHexToDecimal(hex: string): number {
  return parseInt(hex, 16)
}
