import { Redis } from 'ioredis'
import { Pool as PGPool } from 'pg'
import { CherryPicker } from './cherry-picker'
import { getNodeNetworkData } from '../utils'

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

const influxBucket = process.env.NODE_ENV === 'production' ? 'mainnetRelay' : 'mainnetRelayStaging'
const influxClient = new InfluxDB({ url: influxURL, token: influxToken })
const writeApi = influxClient.getWriteApi(influxOrg, influxBucket)

export class MetricsRecorder {
  redis: Redis
  pgPool: PGPool
  cherryPicker: CherryPicker
  processUID: string

  constructor({
    redis,
    pgPool,
    cherryPicker,
    processUID,
  }: {
    redis: Redis
    pgPool: PGPool
    cherryPicker: CherryPicker
    processUID: string
  }) {
    this.redis = redis
    this.pgPool = pgPool
    this.cherryPicker = cherryPicker
    this.processUID = processUID
  }

  // Record relay metrics in redis then push to timescaleDB for analytics
  async recordMetric({
    requestID,
    applicationID,
    applicationPublicKey,
    blockchainID,
    serviceNode,
    relayStart,
    result,
    bytes,
    delivered,
    fallback,
    method,
    error,
    origin,
    data,
  }: {
    requestID: string
    applicationID: string
    applicationPublicKey: string
    blockchainID: string
    serviceNode: string | undefined
    relayStart: [number, number]
    result: number
    bytes: number
    delivered: boolean
    fallback: boolean
    method: string | undefined
    error: string | undefined
    origin: string | undefined
    data: string | undefined
  }): Promise<void> {
    try {
      let elapsedTime = 0
      let elapsedTimeMs = 0
      const relayEnd = process.hrtime(relayStart)

      elapsedTime = (relayEnd[0] * 1e9 + relayEnd[1]) / 1e9
      elapsedTimeMs = Math.ceil((relayEnd[0] * 1e9 + relayEnd[1]) / 1e6)

      let fallbackTag = ''

      if (fallback) {
        fallbackTag = ' FALLBACK'
      }

      let serviceURL = ''
      let serviceDomain = ''

      if (serviceNode && !fallback) {
        const node = await getNodeNetworkData(this.redis, serviceNode, requestID)

        serviceURL = node.serviceURL
        serviceDomain = node.serviceDomain
      }

      if (result === 200) {
        logger.log('info', 'SUCCESS' + fallbackTag + ' RELAYING ' + blockchainID + ' req: ' + data, {
          requestID,
          relayType: 'APP',
          typeID: applicationID,
          serviceNode,
          serviceURL,
          serviceDomain,
          elapsedTime: elapsedTimeMs,
          error: '',
          origin,
          blockchainID,
        })
      } else if (result === 500) {
        logger.log('error', 'FAILURE' + fallbackTag + ' RELAYING ' + blockchainID + ' req: ' + data, {
          requestID,
          relayType: 'APP',
          typeID: applicationID,
          serviceNode,
          serviceURL,
          serviceDomain,
          elapsedTime: elapsedTimeMs,
          error,
          origin,
          blockchainID,
        })
      } else if (result === 503) {
        logger.log('error', 'INVALID RESPONSE' + fallbackTag + ' RELAYING ' + blockchainID + ' req: ' + data, {
          requestID,
          relayType: 'APP',
          typeID: applicationID,
          serviceNode,
          serviceURL,
          serviceDomain,
          elapsedTime: elapsedTimeMs,
          error,
          origin,
          blockchainID,
        })
      }

      // Update service node quality with cherry picker
      if (serviceNode) {
        await this.cherryPicker.updateServiceQuality(blockchainID, applicationID, serviceNode, elapsedTime, result)
      }

      // Bulk insert relay / error metrics
      const postgresTimestamp = new Date()
      const errorValues = [
        postgresTimestamp,
        applicationPublicKey,
        blockchainID,
        serviceNode,
        elapsedTime,
        bytes,
        method,
        error,
      ]

      // Influx
      const pointRelay = new Point('relay')
        .tag('applicationPublicKey', applicationPublicKey)
        .tag('nodePublicKey', serviceNode)
        .tag('method', method)
        .tag('result', result.toString())
        .tag('blockchain', blockchainID) // 0021
        .tag('host', os.hostname())
        .tag('region', region)
        .floatField('bytes', bytes)
        .floatField('elapsedTime', elapsedTime.toFixed(4))
        .timestamp(postgresTimestamp)

      writeApi.writePoint(pointRelay)

      const pointOrigin = new Point('origin')
        .tag('applicationPublicKey', applicationPublicKey)
        .stringField('origin', origin)
        .timestamp(postgresTimestamp)

      writeApi.writePoint(pointOrigin)
      await writeApi.flush()

      // Store errors in redis and every 10 seconds, push to postgres
      const redisErrorKey = 'errors-' + this.processUID
      const currentTimestamp = Math.floor(new Date().getTime() / 1000)

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

      if (relation === 'error') {
        this.pgPool.connect((err, client, release) => {
          if (err) {
            processlogger.log('error', 'Error acquiring client ' + err.stack)
          }
          client.query(metricsQuery, (metricsErr, result) => {
            release()
            if (metricsErr) {
              processlogger.log('error', 'Error executing query on pgpool ' + metricsQuery + ' ' + err.stack)
            }
          })
        })
      }
    }
  }
}
