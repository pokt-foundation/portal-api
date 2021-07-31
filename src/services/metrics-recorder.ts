import { Redis } from 'ioredis'
import { Pool as PGPool } from 'pg'
import { CherryPicker } from './cherry-picker'

import pgFormat from 'pg-format'
import { CustomLogger } from 'ajv'
import { HttpErrors } from '@loopback/rest'
const logger = require('../services/logger')
const os = require('os')

import { InfluxDB, Point } from '@influxdata/influxdb-client'

const region = process.env.REGION || '' // Can be empty
const influxURL = process.env.INFLUX_URL || ''
const influxToken = process.env.INFLUX_TOKEN || ''
const influxOrg = process.env.INFLUX_ORG || ''

if (!influxURL) {
  throw new HttpErrors.InternalServerError('INFLUX_URL required in ENV')
}
if (!influxToken) {
  throw new HttpErrors.InternalServerError('INFLUX_TOKEN required in ENV')
}
if (!influxOrg) {
  throw new HttpErrors.InternalServerError('INFLUX_ORG required in ENV')
}

const influxBucket = 'mainnetRelay'
const influxClient = new InfluxDB({ url: influxURL, token: influxToken })

const writeApi = influxClient.getWriteApi(influxOrg, influxBucket)

writeApi.useDefaultTags({ host: os.hostname(), region: region })

export class MetricsRecorder {
  redis: Redis
  pgPool: PGPool
  pgPool2: PGPool
  cherryPicker: CherryPicker
  processUID: string

  constructor({
    redis,
    pgPool,
    pgPool2,
    cherryPicker,
    processUID,
  }: {
    redis: Redis
    pgPool: PGPool
    pgPool2: PGPool
    cherryPicker: CherryPicker
    processUID: string
  }) {
    this.redis = redis
    this.pgPool = pgPool
    this.pgPool2 = pgPool2
    this.cherryPicker = cherryPicker
    this.processUID = processUID
  }

  // Record relay metrics in redis then push to timescaleDB for analytics
  async recordMetric({
    requestID,
    applicationID,
    applicationPublicKey,
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
    requestID: string
    applicationID: string
    applicationPublicKey: string
    blockchain: string
    serviceNode: string | undefined
    relayStart: [number, number]
    result: number
    bytes: number
    delivered: boolean
    fallback: boolean
    method: string | undefined
    error: string | undefined
  }): Promise<void> {
    try {
      let elapsedTime = 0
      const relayEnd = process.hrtime(relayStart)

      elapsedTime = (relayEnd[0] * 1e9 + relayEnd[1]) / 1e9

      let fallbackTag = ''

      if (fallback) {
        fallbackTag = ' FALLBACK'
      }

      if (result === 200) {
        logger.log('info', 'SUCCESS' + fallbackTag, {
          requestID,
          relayType: 'APP',
          typeID: applicationID,
          serviceNode,
          elapsedTime,
          error: undefined,
        })
      } else if (result === 500) {
        logger.log('error', 'FAILURE' + fallbackTag, {
          requestID,
          relayType: 'APP',
          typeID: applicationID,
          serviceNode,
          elapsedTime,
          error,
        })
      } else if (result === 503) {
        logger.log('error', 'INVALID RESPONSE' + fallbackTag, {
          requestID,
          relayType: 'APP',
          typeID: applicationID,
          serviceNode,
          elapsedTime,
          error,
        })
      }

      // Update service node quality with cherry picker
      if (serviceNode) {
        await this.cherryPicker.updateServiceQuality(blockchain, applicationID, serviceNode, elapsedTime, result)
      }

      // Bulk insert relay / error metrics
      const postgresTimestamp = new Date()
      const metricsValues = [
        postgresTimestamp,
        applicationPublicKey,
        blockchain,
        serviceNode,
        elapsedTime,
        result,
        bytes,
        method,
      ]
      const errorValues = [
        postgresTimestamp,
        applicationPublicKey,
        blockchain,
        serviceNode,
        elapsedTime,
        bytes,
        method,
        error,
      ]

      // Influx
      const point = new Point('relay')
        .tag('applicationPublicKey', applicationPublicKey)
        .tag('nodePublicKey', serviceNode)
        .tag('method', method)
        .tag('result', result.toString())
        .tag('blockchain', blockchain)
        .floatField('bytes', bytes)
        .floatField('elapsedTime', elapsedTime.toFixed(4))
        .timestamp(postgresTimestamp)

      writeApi.writePoint(point)
      await writeApi.flush()

      // Store metrics in redis and every 10 seconds, push to postgres
      const redisMetricsKey = 'metrics-' + this.processUID
      const redisErrorKey = 'errors-' + this.processUID
      const currentTimestamp = Math.floor(new Date().getTime() / 1000)

      await this.processBulkLogs([metricsValues], currentTimestamp, redisMetricsKey, 'relay', logger)

      if (result !== 200) {
        await this.processBulkLogs([errorValues], currentTimestamp, redisErrorKey, 'error', logger)
      }
    } catch (err) {
      logger.log('error', err.stack)
    }
  }

  async processBulkLogs(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bulkData: any[],
    currentTimestamp: number,
    redisKey: string,
    relation: string,
    processlogger: CustomLogger
  ): Promise<void> {
    const redisListAge = await this.redis.get('age-' + redisKey)
    const redisListSize = await this.redis.llen(redisKey)

    // List has been started in redis and needs to be pushed as timestamp is > 10 seconds old
    if (redisListAge && redisListSize > 0 && currentTimestamp > parseInt(redisListAge) + 10) {
      await this.redis.set('age-' + redisKey, currentTimestamp)
      await this.pushBulkData(bulkData, redisListSize, redisKey, relation, processlogger)
    } else {
      await this.redis.rpush(redisKey, JSON.stringify(bulkData))
    }

    if (!redisListAge) {
      await this.redis.set('age-' + redisKey, currentTimestamp)
    }
  }

  async pushBulkData(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bulkData: any[],
    redisListSize: number,
    redisKey: string,
    relation: string,
    processlogger: CustomLogger
  ): Promise<void> {
    for (let count = 0; count < redisListSize; count++) {
      const redisRecord = await this.redis.lpop(redisKey)

      if (redisRecord) {
        bulkData.push(JSON.parse(redisRecord))
      }
    }
    if (bulkData.length > 0) {
      const metricsQuery = pgFormat('INSERT INTO %I VALUES %L', relation, bulkData)

      this.pgPool.connect((err, client, release) => {
        if (err) {
          processlogger.log('error', 'Error acquiring client ' + err.stack)
        }
        client.query(metricsQuery, (metricsErr, result) => {
          release()
          if (metricsErr) {
            processlogger.log('error', 'Error executing query ' + metricsQuery + ' ' + err.stack)
          }
        })
      })

      // Temporary force push to new psql
      if (relation === 'error') {
        this.pgPool2.connect((err, client, release) => {
          if (err) {
            processlogger.log('error', 'Error acquiring client ' + err.stack)
          }
          client.query(metricsQuery, (metricsErr, result) => {
            release()
            if (metricsErr) {
              processlogger.log('error', 'Error executing query on pgpool2 ' + metricsQuery + ' ' + err.stack)
            }
          })
        })
      }
    }
  }
}
