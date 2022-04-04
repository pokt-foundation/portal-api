import { checkWhitelist } from '../enforcements'
import { extractContractAddress } from './parsing'

export function isMethodWhitelisted(method: string, whitelistedMethods: string[]): boolean {
  return checkWhitelist(whitelistedMethods, method, 'explicit')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isContractWhitelisted(rawData: Record<string, any>, whitelistedContracts: string[]): boolean {
  const contractAddress = extractContractAddress(rawData)

  // This means that the method is not supported for this feature,
  // so it shall pass.
  if (!contractAddress) {
    return true
  }

  return checkWhitelist(whitelistedContracts, contractAddress, 'explicit')
}
