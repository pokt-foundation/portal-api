/**
 * @class RelayError
 */
export declare class RelayError extends Error {
    code: number;
    servicer_node: string | undefined;
    constructor(message: string, code: number, servicer_node: string | undefined);
}
