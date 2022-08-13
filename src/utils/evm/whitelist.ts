import { checkWhitelist } from '../enforcements'
import { extractContractAddress } from './parsing'

export function isWhitelisted(value: string, whitelist: string[]): boolean {
  return checkWhitelist(whitelist, value, 'explicit')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isContractWhitelisted(rawData: Record<string, any>, whitelistedContracts: string[]): boolean {
  const { toAddress } = extractContractAddress(rawData)

  // This means that the method is not supported for this feature,
  // so it shall pass.
  if (!toAddress) {
    return true
  }

  return checkWhitelist(whitelistedContracts, toAddress, 'explicit')
}

// Has the contract been widely blocked?
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isContractBlocked(rawData: Record<string, any>, blockedContracts: string[]): boolean {
  const { fromAddress, toAddress } = extractContractAddress(rawData)

  // This means that the method is not supported for this feature,
  // so it shall pass.
  if (!fromAddress && !toAddress) {
    return false
  }

  blockedContracts = blockedContracts.map((x) => x.toLowerCase())

  const isBlocked =
    blockedContracts.includes(fromAddress?.toLowerCase()) || blockedContracts.includes(toAddress?.toLowerCase())

  return isBlocked
}
