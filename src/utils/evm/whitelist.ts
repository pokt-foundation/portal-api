import { checkWhitelist } from '../enforcements'
import { extractContractAddress } from './parsing'

export function isMethodWhitelisted(method: string, whitelistedMethods: string[]): boolean {
  return checkWhitelist(whitelistedMethods, method, 'explicit')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isContractWhitelisted(rawData: Record<string, any>, whitelistedContracts: string[]) {
  const contractAddress = extractContractAddress(rawData)

  if (!contractAddress) {
    return false
  }

  return checkWhitelist(whitelistedContracts, contractAddress, 'explicit')
}
