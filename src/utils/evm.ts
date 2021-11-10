export const EVM_ERROR_CODES = [
  // JSON RPC Standard errors
  '-32',
  // Custom error codes
  '1',
  '2',
  '3',
]

// EVM clients rely on JsonRpc standard, so we check for those errors.
export function isEVMError(response: string): boolean {
  const parsedResponse = JSON.parse(response)
  const errorCode = String(parsedResponse.error?.code)

  if (errorCode === 'undefined') {
    return false
  }

  return EVM_ERROR_CODES.some((error) => errorCode.includes(error))
}
