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
  }

  async flushResults(requestID: string, blockchain: string, functionName: string, results: ProfileResult[]): Promise<void> {
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