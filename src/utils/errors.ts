import { parseJSONRPCError } from './parsing'

// EVM clients rely on JsonRpc standard, so we check for those errors.
export function isEVMError(response: string): boolean {
  try {
    const { code } = parseJSONRPCError(response)

    // 3 is execution error
    // -32000 itself can be thrown for what are server errors, all other -32000 are user errors
    return code === 3 || code < -32000
  } catch {
    return false
  }
}
