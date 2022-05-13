import { parseJSONRPCError } from './parsing'

// EVM clients rely on JsonRpc standard, so we check for those errors.
export function isEVMError(response: string): boolean {
  try {
    const { code } = parseJSONRPCError(response)

    return code === 3 || code < -32000
  } catch {
    return false
  }
}
