/**
 * @class RelayError
 */
export class RelayError extends Error {
  code: number;
  servicer_node: string | undefined;
  constructor(
    message: string,
    code: number,
    servicer_node: string | undefined,
  ) {
    super(message);
    this.name = 'RelayError';
    this.code = code;
    this.servicer_node = servicer_node;
  }
}
