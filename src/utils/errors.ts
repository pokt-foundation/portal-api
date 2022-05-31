import { parseJSONRPCError } from './parsing'

// Messages thrown by evm clients like Geth that are node fault, not user fault.
const EVM_SERVER_ERROR_MSGS = ['connection error']

// EVM clients rely on JsonRpc standard, so we check for those errors.
export function isUserErrorEVM(response: string): boolean {
  try {
    const { code, message } = parseJSONRPCError(response)

    const serverError = EVM_SERVER_ERROR_MSGS.some((err) => message.includes(err))

    // 3 is execution error
    // -32000 itself can be thrown for what are server errors
    // all other -32000 are user errors
    return (!serverError && code === -32000) || code === 3 || code < -32000
  } catch {
    return false
  }
}
