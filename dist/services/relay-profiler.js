"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pocket_js_1 = require("@pokt-network/pocket-js");
const pgFormat = require('pg-format');
const logger = require('../services/logger');
class RelayProfiler extends pocket_js_1.BaseProfiler {
    constructor({ pgPool, }) {
        super();
        this.data = [];
        this.pgPool = pgPool;
    }
    flushResults(requestID, functionName, results) {
        const bulkData = [];
        results.forEach((result) => {
            bulkData.push({
                "request_id": requestID,
                "function": functionName,
                "block_key": result.blockKey,
                "elapsed_time": result.timeElapsed
            });
        });
        logger.log('info', 'FLUSHING BULK: ' + bulkData.length, { requestID: '', relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: '' });
        if (bulkData.length > 0) {
            const metricsQuery = pgFormat('INSERT INTO profile VALUES %L', bulkData);
            logger.log('info', 'FLUSHING QUERY: ' + JSON.stringify(metricsQuery), { requestID: '', relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: '' });
            this.pgPool.connect((err, client, release) => {
                if (err) {
                    logger.log('error', 'Error acquiring client ' + err.stack);
                }
                client.query(metricsQuery, (err, result) => {
                    logger.log('info', 'FLUSHING RESULT: ' + JSON.stringify(result), { requestID: '', relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: '' });
                    release();
                    if (err) {
                        logger.log('error', 'Error executing query ' + metricsQuery + ' ' + err.stack);
                    }
                });
            });
        }
    }
}
exports.RelayProfiler = RelayProfiler;
//# sourceMappingURL=relay-profiler.js.map