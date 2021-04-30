import {
  BaseProfiler,
  ProfileResult,
} from '@pokt-network/pocket-js';

import {Pool as PGPool} from 'pg';

const pgFormat = require('pg-format');
const logger = require('../services/logger');

export class RelayProfiler extends BaseProfiler {
  public data: {key: string, time_elapsed: number | undefined}[] = []
  pgPool: PGPool;

  constructor({
    pgPool,
  }: {
    pgPool: PGPool;
  }) {
    super();
    this.pgPool = pgPool;
  }

  flushResults(requestID: string, functionName: string, results: ProfileResult[]): void {

    const bulkData: { request_id: string; function: string; block_key: string; elapsed_time: number; }[] = [];
    results.forEach((result) => {
      bulkData.push(
        {
          "request_id": requestID,
          "function": functionName,
          "block_key": result.blockKey,
          "elapsed_time": result.timeElapsed
        }
      );
    });

    if (bulkData.length > 0) {
      const metricsQuery = pgFormat('INSERT INTO profile VALUES %L', bulkData);
      this.pgPool.connect((err, client, release) => {
        if (err) {
          logger.log('error', 'Error acquiring client ' + err.stack);
        }
          client.query(metricsQuery, (err, result) => {
          release();
          if (err) {
            logger.log('error', 'Error executing query ' + metricsQuery + ' ' + err.stack);
          }
        });
      });
    }
  }
}