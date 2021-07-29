/**
 * @class LimitError
 */
export class LimitError extends Error {
  method: string
  message: string
  constructor(message: string, method: string) {
    super()
    this.name = 'LimitError'
    this.message = message
    this.method = method
  }
}
