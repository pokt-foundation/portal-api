import {Redis} from 'ioredis';
import {Pool as PGPool} from 'pg';
import {CherryPicker} from './cherry-picker';

const pgFormat = require('pg-format');
const logger = require('../services/logger');

export class MetricsRecorder {
  redis: Redis;
  pgPool: PGPool;
  cherryPicker: CherryPicker;
  processUID: string;

  constructor({
    redis,
    pgPool,
    cherryPicker,
    processUID,
  }: {
    redis: Redis;
    pgPool: PGPool;
    cherryPicker: CherryPicker;
    processUID: string;
  }) {
    this.redis = redis;
    this.pgPool = pgPool;
    this.cherryPicker = cherryPicker;
    this.processUID = processUID;
  }

  // Record relay metrics in redis then push to timescaleDB for analytics
  async recordMetric({
    requestID,
    applicationID,
    appPubKey,
    blockchain,
    serviceNode,
    relayStart,
    result,
    bytes,
    delivered,
    fallback,
    method,
    error,
  }: {
    requestID: string;
    applicationID: string;
    appPubKey: string;
    blockchain: string;
    serviceNode: string | undefined;
    relayStart: [number, number];
    result: number;
    bytes: number;
    delivered: boolean;
    fallback: boolean;
    method: string | undefined;
    error: string | undefined;
  }): Promise<void> {
    try {
      const relayEnd = process.hrtime(relayStart);
      const elapsedTime = (relayEnd[0] * 1e9 + relayEnd[1]) / 1e9;
      let fallbackTag = '';

      if (fallback) {
        fallbackTag = ' FALLBACK';
      }

      if (result === 200) {
        logger.log('info', 'SUCCESS' + fallbackTag, {requestID: requestID, relayType: 'APP', typeID: applicationID, serviceNode: serviceNode});
      } else if (result === 500) {
        logger.log('error', 'FAILURE' + fallbackTag + ' ' + error, {requestID: requestID, relayType: 'APP', typeID: applicationID, serviceNode: serviceNode});
      } else if (result === 503) {
        logger.log('error', 'INVALID RESPONSE' + fallbackTag + ' ' + error, {requestID: requestID, relayType: 'APP', typeID: applicationID, serviceNode: serviceNode});
      }

      const metricsValues = [
        new Date(),
        appPubKey,
        blockchain,
        serviceNode,
        elapsedTime,
        result,
        bytes,
        method,
      ];

      // Store metrics in redis and every 5 seconds, push to Timescale
      const redisMetricsKey = 'metrics-' + this.processUID;
      const redisListAge = await this.redis.get('age-' + redisMetricsKey);
      const currentTimestamp = Math.floor(new Date().getTime() / 1000);

      // List has been started in redis and needs to be pushed as timestamp is > 5 seconds old
      if (
        redisListAge &&
        currentTimestamp > parseInt(redisListAge) + 5
        ) {
        // Set new ttl for the list age
        await this.redis.set('age-' + redisMetricsKey, currentTimestamp);
        
        // Load the bulk data with our current request
        const bulkData = [metricsValues];
        
        // Redis atomic request:
        // Load all items of the metrics list from redis
        // Delete the array
        // Push them into bulk data
        this.redis.multi().lrange(redisMetricsKey, 0, -1)
        .del(redisMetricsKey)
        .exec(async (err, metrics) => {
          if (err) {
            logger.log('error', 'Error retreiving metrics ' + err.stack);
          }
          else {
            if (metrics.length > 0) {
              metrics.forEach((metric) => {
                if (typeof metric === "string") {
                  bulkData.push(JSON.parse(metric));
                }
              });
              
              // Push bulk insert to metrics DB
              const metricsQuery = pgFormat('INSERT INTO relay VALUES %L', bulkData);
              this.pgPool.connect((err, client, release) => {
                if (err) {
                  logger.log('error', 'Error acquiring client ' + err.stack);
                }
                else {
                  client.query(metricsQuery, (err, result) => {
                    release();
                    if (err) {
                      logger.log('error', 'Error executing query ' + metricsQuery + ' ' + err.stack);
                    }
                  });
                }
              });
            } else {
              // Store this current request for later as another thread pushed in the metrics
              await this.redis.rpush(redisMetricsKey, JSON.stringify(metricsValues));
            }
          } 
        });
      } else {
        // Not ready for batching, insert current value into redis list
        await this.redis.rpush(redisMetricsKey, JSON.stringify(metricsValues));
      }

      if (!redisListAge) {
        await this.redis.set('age-' + redisMetricsKey, currentTimestamp);
      }

      if (serviceNode) {
        await this.cherryPicker.updateServiceQuality(
          blockchain,
          applicationID,
          serviceNode,
          elapsedTime,
          result,
        );
      }
    } catch (err) {
      logger.log('error', err.stack);
    }
  }
}
