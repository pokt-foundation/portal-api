/* eslint-disable @typescript-eslint/naming-convention */
/**
 * @class LimitError
 */
export class LimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LimitError'
  }
}
