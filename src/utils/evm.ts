import { parseJSONRPCError } from './parsing'

export const EVM_ERROR_CODES = [
  // JSON RPC Standard errors
  '-32',
]

// EVM clients rely on JsonRpc standard, so we check for those errors.
export function isEVMError(response: string): boolean {
  try {
    const { code } = parseJSONRPCError(response)

    return EVM_ERROR_CODES.some((error) => String(code).includes(error))
  } catch {
    return false
  }
}
