export function blockHexToDecimal(hex: string): number {
  return parseInt(hex)
}

export function blockHexToBigInt(hex: string): bigint {
  return BigInt(hex)
}

export function isBlockHex(block: string): boolean {
  return /^[A-F0-9]+$/i.test(block)
}
