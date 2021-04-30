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

  constructor(pgPool: PGPool) {
    super();
    this.pgPool = pgPool;
    console.log(this.pgPool);
  }

  flushResults(requestID: string, functionName: string, results: ProfileResult[]): void {

    console.log(this.pgPool);
    logger.log('info', 'FLUSHING pool: ' + JSON.stringify(this.pgPool), {requestID: '', relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: ''});

    const bulkData: any[] = [];
    const timestamp = new Date();

    results.forEach((result) => {
      bulkData.push(
        [
          timestamp,
          requestID,
          functionName,
          result.blockKey,
          result.timeElapsed,
        ]
      );
    });

    if (bulkData.length > 0) {
      const metricsQuery = pgFormat('INSERT INTO profile VALUES %L', bulkData);

      logger.log('info', 'FLUSHING QUERY: ' + JSON.stringify(metricsQuery), {requestID: '', relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: ''});
      
      this.pgPool.connect((err, client, release) => {
        if (err) {
          logger.log('error', 'FLUSHING Error acquiring client ' + err.stack);
        }
        client.query(metricsQuery, (err, result) => {          
          release();
          if (err) {
            logger.log('error', 'FLUSHING Error executing query ' + metricsQuery + ' ' + err.stack);
          }
        });
      });
    }
  }
}