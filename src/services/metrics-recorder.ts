import process from 'process'
import { CustomLogger } from 'ajv'
import AWS from 'aws-sdk'
import { Redis } from 'ioredis'
import { Pool as PGPool } from 'pg'

import pgFormat from 'pg-format'

import { HttpErrors } from '@loopback/rest'
import { Point, WriteApi } from '@influxdata/influxdb-client'

import { getNodeNetworkData } from '../utils/cache'
import { CherryPicker } from './cherry-picker'
const os = require('os')
const logger = require('../services/logger')

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

export class MetricsRecorder {
  redis: Redis
  influxWriteAPI: WriteApi
  pgPool: PGPool
  timestreamClient: AWS.TimestreamWrite
  cherryPicker: CherryPicker
  processUID: string

  constructor({
    redis,
    influxWriteAPI,
    pgPool,
    timestreamClient,
    cherryPicker,
    processUID,
  }: {
    redis: Redis
    influxWriteAPI: WriteApi
    pgPool: PGPool
    timestreamClient: AWS.TimestreamWrite
    cherryPicker: CherryPicker
    processUID: string
  }) {
    this.redis = redis
    this.influxWriteAPI = influxWriteAPI
    this.pgPool = pgPool
    this.timestreamClient = timestreamClient
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
    sessionKey,
    timeout,
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
    sessionKey: string | undefined
    timeout?: number
  }): Promise<void> {
    try {
      let elapsedTime = 0
      const relayEnd = process.hrtime(relayStart)

      elapsedTime = (relayEnd[0] * 1e9 + relayEnd[1]) / 1e9

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
          elapsedTime,
          error: '',
          origin,
          blockchainID,
          sessionKey,
        })
      } else if (result === 500) {
        logger.log('error', 'FAILURE' + fallbackTag + ' RELAYING ' + blockchainID + ' req: ' + data, {
          requestID,
          relayType: 'APP',
          typeID: applicationID,
          serviceNode,
          serviceURL,
          serviceDomain,
          elapsedTime,
          error,
          origin,
          blockchainID,
          sessionKey,
        })
      } else if (result === 503) {
        logger.log('error', 'INVALID RESPONSE' + fallbackTag + ' RELAYING ' + blockchainID + ' req: ' + data, {
          requestID,
          relayType: 'APP',
          typeID: applicationID,
          serviceNode,
          serviceURL,
          serviceDomain,
          elapsedTime,
          error,
          origin,
          blockchainID,
          sessionKey,
        })
      }

      // Update service node quality with cherry picker
      if (serviceNode) {
        await this.cherryPicker.updateServiceQuality(
          blockchainID,
          applicationID,
          serviceNode,
          elapsedTime,
          result,
          timeout,
          sessionKey
        )
      }

      // Text timestamp
      const relayTimestamp = new Date()

      // Redis timestamp for bulk logs
      const redisTimestamp = Math.floor(new Date().getTime() / 1000)

      // MARKED FOR REMOVAL --------------------------------------
      // InfluxDB
      const pointRelay = new Point('relay')
        .tag('applicationPublicKey', applicationPublicKey)
        .tag('nodePublicKey', serviceNode)
        .tag('method', method)
        .tag('result', result.toString())
        .tag('blockchain', blockchainID) // 0021
        .tag('host', os.hostname())
        .tag('region', process.env.REGION || '')
        .floatField('bytes', bytes)
        .floatField('elapsedTime', elapsedTime.toFixed(4))
        .timestamp(relayTimestamp)

      this.influxWriteAPI.writePoint(pointRelay)

      const pointOrigin = new Point('origin')
        .tag('applicationPublicKey', applicationPublicKey)
        .stringField('origin', origin)
        .timestamp(relayTimestamp)

      this.influxWriteAPI.writePoint(pointOrigin)
      // MARKED FOR REMOVAL --------------------------------------

      // AWS Timestream Metrics
      const nodeType = serviceNode.includes('fallback') ? 'fallback' : 'network'

      const timeStreamDimensions = [
        { Name: 'region', Value: `${process.env.REGION || ''}` },
        { Name: 'applicationPublicKey', Value: `${applicationPublicKey}` },
        { Name: 'nodeType', Value: `${nodeType}` },
        { Name: 'blockchainID', Value: `${blockchainID}` },
        { Name: 'method', Value: `${method || 'none'}` },
        { Name: 'origin', Value: `${origin || 'none'}` },
        { Name: 'result', Value: `${result}` },
      ]

      // console.log(timeStreamDimensions)

      const timeStreamMeasure = {
        Dimensions: timeStreamDimensions,
        MeasureName: 'elapsedTime',
        MeasureValue: `${parseFloat(elapsedTime.toFixed(4))}`,
        MeasureValueType: 'DOUBLE',
        Time: Date.now().toString(),
      }

      const records = [timeStreamMeasure]

      const timestreamDatabaseName = `mainnet-${process.env['NODE_ENV']}`

      const timestreamWrite = {
        DatabaseName: timestreamDatabaseName,
        TableName: 'relay',
        Records: records,
      }

      const request = this.timestreamClient.writeRecords(timestreamWrite)

      await request.promise()

      // Store errors in redis and every 10 seconds, push to postgres
      const redisErrorKey = 'errors-' + this.processUID

      // Bulk insert relay / error metrics
      const errorValues = [
        relayTimestamp,
        applicationPublicKey,
        blockchainID,
        serviceNode,
        elapsedTime,
        bytes,
        method,
        error,
      ]

      if (result !== 200) {
        await this.processBulkErrors([errorValues], redisTimestamp, redisErrorKey, logger)
      }
    } catch (err) {
      logger.log('error', err.stack)
    }
  }

  async processBulkErrors(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bulkData: any[],
    currentTimestamp: number,
    redisKey: string,
    processlogger: CustomLogger
  ): Promise<void> {
    const redisListAge = await this.redis.get('age-' + redisKey)
    const redisListSize = await this.redis.llen(redisKey)

    // List has been started in redis and needs to be pushed as timestamp is > 10 seconds old
    if (redisListAge && redisListSize > 0 && currentTimestamp > parseInt(redisListAge) + 10) {
      await this.redis.set('age-' + redisKey, currentTimestamp)
      await this.pushBulkErrors(bulkData, redisListSize, redisKey, processlogger)
    } else {
      await this.redis.rpush(redisKey, JSON.stringify(bulkData))
    }

    if (!redisListAge) {
      await this.redis.set('age-' + redisKey, currentTimestamp)
    }
  }

  async pushBulkErrors(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bulkData: any[],
    redisListSize: number,
    redisKey: string,
    processlogger: CustomLogger
  ): Promise<void> {
    for (let count = 0; count < redisListSize; count++) {
      const redisRecord = await this.redis.lpop(redisKey)

      if (redisRecord) {
        bulkData.push(JSON.parse(redisRecord))
      }
    }
    if (bulkData.length > 0) {
      const metricsQuery = pgFormat('INSERT INTO %I VALUES %L', 'error', bulkData)

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
