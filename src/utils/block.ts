export function blockHexToDecimal(hex: string): number {
  return parseInt(hex, 16)
}

export function isBlockHex(block: string): boolean {
  return /^[A-F0-9]+$/i.test(block)
}
