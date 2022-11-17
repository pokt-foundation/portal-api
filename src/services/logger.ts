import crypto from 'crypto'
import os from 'os'
import { LogEntry } from 'winston'
import WinstonCloudwatch from 'winston-cloudwatch'
import { HttpErrors } from '@loopback/rest'

require('dotenv').config()
const DatadogWinston = require('datadog-winston')
const { createLogger, format, transports: winstonTransports } = require('winston')
const LokiWinston = require('winston-loki')

const { printf } = format

interface Log {
  level: string
  message: string
  requestID: string
  relayType: string
  typeID: string
  serviceNode: string
  error: string | undefined
  elapsedTime: number
  blockchainID: string
  origin: string
  serviceURL: string
  serviceDomain: string
  sessionKey: string
  sticky: string
  gigastakeAppID: string
}

const environment = process.env.NODE_ENV || 'production'
const logToCloudWatch = process.env.LOG_TO_CLOUDWATCH === 'true'
const accessKeyID = process.env.AWS_ACCESS_KEY_ID || ''
const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || ''
const region = process.env.REGION || ''
const logToDataDog = process.env.LOG_TO_DATADOG === 'true'
const ddApiKey = process.env.DATADOG_API_KEY || ''
const silent = process.env.SILENT_LOGGING === 'true'

const logToLoki = process.env.LOG_TO_LOKI === 'true'
const lokiHost = process.env.LOKI_HOST || 'http://127.0.0.1:3100'
const lokiBasicAuth = process.env.LOKI_BASIC_AUTH || ''

const timestampUTC = () => {
  const timestamp = new Date()

  return timestamp.toISOString()
}

const consoleFormat = printf(
  ({
    level,
    message,
    requestID = '',
    relayType = '',
    typeID = '',
    error = '',
    elapsedTime,
    blockchainID = '',
    origin = '',
    serviceNode = '',
    serviceURL = '',
    serviceDomain = '',
    sessionKey = '',
    sticky = 'NONE',
    gigastakeAppID = '',
  }: Log) => {
    return `[${timestampUTC()}] [${level}] [${requestID}] [${relayType}] [${typeID}] [${serviceNode}] [${serviceURL}] [${serviceDomain}] [${sessionKey}] [${error}] [${elapsedTime}] [${blockchainID}] [${origin}] [sticky: ${sticky}] [${gigastakeAppID}] ${message}`
  }
)

const startTime = new Date().toISOString()

const logFormat = format.combine(
  format.colorize(),
  format.simple(),
  format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS',
  }),
  consoleFormat
)

const logName = (process.env.REGION_NAME || '') + '/ecs/gateway'

const options = {
  console: {
    level: 'debug',
    handleExceptions: true,
    colorize: true,
    format: format.json(),
    silent,
  },
  aws: {
    name: 'cloudwatch-log',
    logGroupName: logName,
    logStreamName: function () {
      // Spread log streams across hours as the server stays up
      const date = new Date().toISOString().slice(0, 13)

      return logName + '-' + date + '-' + crypto.createHash('md5').update(startTime).digest('hex')
    },
    awsRegion: region,
    awsAccessKeyId: accessKeyID,
    awsSecretKey: awsSecretAccessKey,
    level: 'verbose',
    messageFormatter: (logObject: LogEntry) => {
      return JSON.stringify({
        timestamp: timestampUTC(),
        ...logObject,
      })
    },
  },
  datadog: {
    apiKey: ddApiKey,
    hostname: os.hostname(),
    service: logName,
    ddsource: 'nodejs',
    intakeRegion: 'eu',
    ddtags: `region:${region}`,
  },
  loki: {
    host: lokiHost,
    basicAuth: lokiBasicAuth,
    json: true,
    labels: { app: logName },
    format: format.json(),
    replaceTimestamp: true,
    onConnectionError: (err) => console.error(err),
  },
}

const getTransports = () => {
  const transports = [new winstonTransports.Console(options.console)]

  if (environment === 'production' || environment === 'staging') {
    if (logToCloudWatch || logToDataDog) {
      if (!region) {
        throw new HttpErrors.InternalServerError('REGION required in ENV')
      }
    }

    if (logToCloudWatch) {
      transports.push(new WinstonCloudwatch(options.aws))
    }

    if (logToDataDog) {
      if (!ddApiKey) {
        throw new HttpErrors.InternalServerError('DATADOG_API_KEY required in ENV')
      }

      transports.push(new DatadogWinston(options.datadog))
    }

    if (logToLoki) {
      if (!lokiHost) {
        throw new HttpErrors.InternalServerError('LOKI_HOST required in ENV')
      }

      transports.push(new LokiWinston(options.loki))
    }
  }

  return transports
}

const perEnvTransports = getTransports()

module.exports = createLogger({
  format: format.json(),
  transports: perEnvTransports,
  exitOnError: false,
})
