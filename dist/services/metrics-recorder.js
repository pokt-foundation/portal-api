"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pgFormat = require('pg-format');
const logger = require('../services/logger');
class MetricsRecorder {
    constructor({ redis, pgPool, cherryPicker, processUID, }) {
        this.redis = redis;
        this.pgPool = pgPool;
        this.cherryPicker = cherryPicker;
        this.processUID = processUID;
    }
    // Record relay metrics in redis then push to timescaleDB for analytics
    async recordMetric({ requestID, applicationID, appPubKey, blockchain, serviceNode, relayStart, result, bytes, delivered, fallback, method, error, }) {
        try {
            let elapsedTime = 0;
            const relayEnd = process.hrtime(relayStart);
            elapsedTime = (relayEnd[0] * 1e9 + relayEnd[1]) / 1e9;
            let fallbackTag = '';
            if (fallback) {
                fallbackTag = ' FALLBACK';
            }
            if (result === 200) {
                logger.log('info', 'SUCCESS' + fallbackTag, { requestID, relayType: 'APP', typeID: applicationID, serviceNode, elapsedTime, error: undefined });
            }
            else if (result === 500) {
                logger.log('error', 'FAILURE' + fallbackTag, { requestID, relayType: 'APP', typeID: applicationID, serviceNode, elapsedTime, error });
            }
            else if (result === 503) {
                logger.log('error', 'INVALID RESPONSE' + fallbackTag, { requestID, relayType: 'APP', typeID: applicationID, serviceNode, elapsedTime, error });
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
            // Store metrics in redis and every 10 seconds, push to postgres
            const redisMetricsKey = 'metrics-' + this.processUID;
            const redisListAge = await this.redis.get('age-' + redisMetricsKey);
            const redisListSize = await this.redis.llen(redisMetricsKey);
            const currentTimestamp = Math.floor(new Date().getTime() / 1000);
            // List has been started in redis and needs to be pushed as timestamp is > 10 seconds old
            if (redisListAge &&
                redisListSize > 0 &&
                currentTimestamp > parseInt(redisListAge) + 10) {
                await this.redis.set('age-' + redisMetricsKey, currentTimestamp);
                const bulkData = [metricsValues];
                for (let count = 0; count < redisListSize; count++) {
                    const redisRecord = await this.redis.lpop(redisMetricsKey);
                    if (redisRecord) {
                        bulkData.push(JSON.parse(redisRecord));
                    }
                }
                if (bulkData.length > 0) {
                    const metricsQuery = pgFormat('INSERT INTO relay VALUES %L', bulkData);
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
            else {
                await this.redis.rpush(redisMetricsKey, JSON.stringify(metricsValues));
            }
            if (!redisListAge) {
                await this.redis.set('age-' + redisMetricsKey, currentTimestamp);
            }
            if (serviceNode) {
                await this.cherryPicker.updateServiceQuality(blockchain, applicationID, serviceNode, elapsedTime, result);
            }
        }
        catch (err) {
            logger.log('error', err.stack);
        }
    }
}
exports.MetricsRecorder = MetricsRecorder;
//# sourceMappingURL=metrics-recorder.js.map