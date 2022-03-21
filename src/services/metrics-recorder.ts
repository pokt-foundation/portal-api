import process from 'process'
import { Session } from '@pokt-foundation/pocketjs-types'
import { Logger } from 'ajv'
import { Redis } from 'ioredis'
import { Pool as PGPool } from 'pg'

import pgFormat from 'pg-format'
import { Point, WriteApi } from '@influxdata/influxdb-client'

import { getNodeNetworkData } from '../utils/cache'
import { BLOCK_TIMING_ERROR } from '../utils/constants'
import { hashBlockchainNodes } from '../utils/helpers'
import { CherryPicker } from './cherry-picker'
const os = require('os')
const logger = require('../services/logger')

export class MetricsRecorder {
  redis: Redis
  influxWriteAPI: WriteApi
  pgPool: PGPool
  cherryPicker: CherryPicker
  processUID: string

  constructor({
    redis,
    influxWriteAPI,
    pgPool,
    cherryPicker,
    processUID,
  }: {
    redis: Redis
    influxWriteAPI: WriteApi
    pgPool: PGPool
    cherryPicker: CherryPicker
    processUID: string
  }) {
    this.redis = redis
    this.influxWriteAPI = influxWriteAPI
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
    fallback,
    method,
    error,
    code,
    origin,
    data,
    session,
    timeout,
    sticky,
    elapsedTime = 0,
    gigastakeAppID,
    sessionBlockHeight,
  }: {
    requestID: string
    applicationID: string
    applicationPublicKey: string
    blockchainID: string
    serviceNode: string | undefined
    relayStart?: [number, number]
    result: number
    bytes: number
    fallback: boolean
    method: string | undefined
    error: string | undefined
    code: string | undefined
    origin: string | undefined
    data: string | undefined
    session: Session | undefined
    timeout?: number
    sticky?: string
    elapsedTime?: number
    gigastakeAppID?: string
    sessionBlockHeight?: number | BigInt
  }): Promise<void> {
    try {
      const { key: sessionKey } = session || {}

      // Might come empty
      applicationPublicKey = applicationPublicKey || 'no_public_key'

      if (!elapsedTime) {
        const relayEnd = process.hrtime(relayStart)

        elapsedTime = (relayEnd[0] * 1e9 + relayEnd[1]) / 1e9
      }

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

      // Parse value if coming as BigInt
      sessionBlockHeight = sessionBlockHeight ? parseInt(sessionBlockHeight.toString()) : sessionBlockHeight

      if (result === 200) {
        logger.log('info', 'SUCCESS' + fallbackTag + ' RELAYING ' + blockchainID + ' req: ' + data, {
          requestID,
          relayType: 'APP',
          typeID: applicationID,
          gigastakeAppID,
          serviceNode,
          serviceURL,
          serviceDomain,
          elapsedTime,
          error: '',
          origin,
          blockchainID,
          sessionKey,
          sticky,
          sessionBlockHeight,
        })
      } else if (result === 500) {
        logger.log('error', 'FAILURE' + fallbackTag + ' RELAYING ' + blockchainID + ' req: ' + data, {
          requestID,
          relayType: 'APP',
          typeID: applicationID,
          gigastakeAppID,
          serviceNode,
          serviceURL,
          serviceDomain,
          elapsedTime,
          error,
          origin,
          blockchainID,
          sessionKey,
          sticky,
          sessionBlockHeight,
        })
      } else if (result === 503) {
        logger.log('error', 'INVALID RESPONSE' + fallbackTag + ' RELAYING ' + blockchainID + ' req: ' + data, {
          requestID,
          relayType: 'APP',
          typeID: applicationID,
          gigastakeAppID,
          serviceNode,
          serviceURL,
          serviceDomain,
          elapsedTime,
          error,
          origin,
          blockchainID,
          sessionKey,
          sticky,
          sessionBlockHeight,
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
          session
        )
      }

      // Text timestamp
      const relayTimestamp = new Date()

      // Redis timestamp for bulk logs
      const redisTimestamp = Math.floor(new Date().getTime() / 1000)

      // InfluxDB
      const pointRelay = new Point('relay')
        .tag('applicationPublicKey', applicationPublicKey)
        .tag('nodePublicKey', serviceNode && !fallback ? 'network' : 'fallback')
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
        code,
      ]

      // Increment node errors
      if (result !== 200) {
        // TODO: FIND Better way to check for valid service nodes (public key)
        if (serviceNode && serviceNode.length === 64 && error !== BLOCK_TIMING_ERROR) {
          // Increment error log
          await this.redis.incr(blockchainID + '-' + serviceNode + '-errors')
          await this.redis.expire(blockchainID + '-' + serviceNode + '-errors', 60)
        }
      }

      // Process error logs
      if (result !== 200 || error !== '' || code !== '') {
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
    processlogger: Logger
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
    processlogger: Logger
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
