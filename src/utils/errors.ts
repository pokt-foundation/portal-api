import { parseJSONRPCError } from './parsing'

export const EVM_ERROR_CODES = [
  // JSON RPC Standard errors
  '-32',
  // Execution reverted error
  '3',
]

// EVM clients rely on JsonRpc standard, so we check for those errors.
export function isEVMError(response: string): boolean {
  return isError(response, EVM_ERROR_CODES)
}

function isError(response: string, errorsToCheck: string[]): boolean {
  try {
    const { code } = parseJSONRPCError(response)

    return errorsToCheck.some((error) => String(code).includes(error))
  } catch {
    return false
  }
}
