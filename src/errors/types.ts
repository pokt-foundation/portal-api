/**
 * @class RelayError
 */
export class RelayError extends Error {
  code: number
  servicer_node: string | undefined
  constructor(message: string, code: number, servicer_node: string | undefined) {
    super(message)
    this.name = 'RelayError'
    this.code = code
    this.servicer_node = servicer_node
  }
}

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

export const MAX_RELAYS_ERROR = 'the evidence is sealed, either max relays reached or claim already submitted'
