import { parseJSONRPCError } from './parsing'

// some clients use -32000 for both server/user errors, so message match is needed
const EVM_USER_ERROR_MSGS = ['execution reverted', 'stack underflow', 'cannot be found']

// EVM clients rely on JsonRpc standard, so we check for those errors.
export function isUserErrorEVM(response: string): boolean {
  try {
    const { code, message } = parseJSONRPCError(response)

    const userError = EVM_USER_ERROR_MSGS.some((err) => message.includes(err))

    // 3 is execution error
    // -32000 itself can be thrown for what are server errors (except for execution reverted & stack underflow)
    // all other -32000 are user errors
    return userError || code === 3 || code < -32000
  } catch {
    return false
  }
}
