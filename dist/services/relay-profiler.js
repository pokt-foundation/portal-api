"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pocket_js_1 = require("@pokt-network/pocket-js");
const logger = require('../services/logger');
class RelayProfiler extends pocket_js_1.BaseProfiler {
    constructor() {
        super(...arguments);
        this.data = [];
    }
    flushResults(functionName, results) {
        const resultsJSON = [];
        results.forEach(function (result) {
            resultsJSON.push(result.toJSON());
        });
        const obj = {
            function_name: functionName,
            results: resultsJSON
        };
        logger.log('debug', JSON.stringify(obj), { requestID: '', relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: '' });
    }
}
exports.RelayProfiler = RelayProfiler;
//# sourceMappingURL=relay-profiler.js.map