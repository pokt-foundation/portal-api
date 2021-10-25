import { EVM_ERROR_CODES } from './constants'

// EVM clients rely on JsonRpc standard, so we check for those errors.
export function isEVMError(response: string): boolean {
  const parsedResponse = JSON.parse(response)
  const errorCode = parsedResponse.error?.code

  if (!errorCode) {
    return false
  }

  return EVM_ERROR_CODES.some((error) => errorCode.includes(error))
}
