"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pocket_js_1 = require("@pokt-network/pocket-js");
const pgFormat = require('pg-format');
const logger = require('../services/logger');
class RelayProfiler extends pocket_js_1.BaseProfiler {
    constructor(pgPool) {
        super();
        this.data = [];
        this.pgPool = pgPool;
    }
    async flushResults(requestID, blockchain, functionName, results) {
        /*
        const bulkData: any[] = [];
        const timestamp = new Date();
    
        results.forEach((result) => {
          bulkData.push(
            [
              timestamp,
              requestID,
              blockchain,
              functionName,
              result.blockKey,
              (result.timeElapsed !== 0 ? result.timeElapsed / 1000 : 0),
            ]
          );
        });
    
        if (bulkData.length > 0) {
          const metricsQuery = pgFormat('INSERT INTO profile VALUES %L', bulkData);
          
          this.pgPool.connect((err, client, release) => {
            if (err) {
              logger.log('error', 'FLUSHING ERROR acquiring client ' + err.stack);
            }
            client.query(metricsQuery, (err, result) => {
              release();
              if (err) {
                logger.log('error', 'FLUSHING ERROR executing query ' + metricsQuery + ' ' + err.stack);
              }
            });
          });
        }
        */
    }
}
exports.RelayProfiler = RelayProfiler;
//# sourceMappingURL=relay-profiler.js.map