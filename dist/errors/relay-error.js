"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayError = void 0;
/**
 * @class RelayError
 */
class RelayError extends Error {
    constructor(message, code, servicer_node) {
        super(message);
        this.name = "RelayError";
        this.code = code;
        this.servicer_node = servicer_node;
    }
}
exports.RelayError = RelayError;
//# sourceMappingURL=relay-error.js.map