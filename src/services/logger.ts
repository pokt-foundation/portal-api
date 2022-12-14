import crypto from 'crypto'
import os from 'os'
import { LogEntry } from 'winston'
import { HttpErrors } from '@loopback/rest'

require('dotenv').config()
const { createLogger, format, transports: winstonTransports } = require('winston')
const LokiWinston = require('winston-loki')

const accessKeyID = process.env.AWS_ACCESS_KEY_ID || ''
const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || ''
const region = process.env.REGION || ''
const silent = process.env.SILENT_LOGGING === 'true'

const logToLoki = process.env.LOG_TO_LOKI === 'true'
const lokiHost = process.env.LOKI_HOST || 'http://127.0.0.1:3100'
const lokiBasicAuth = process.env.LOKI_BASIC_AUTH || ''

const timestampUTC = () => {
  const timestamp = new Date()

  return timestamp.toISOString()
}

const startTime = new Date().toISOString()

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
  loki: {
    host: lokiHost,
    basicAuth: lokiBasicAuth,
    json: true,
    labels: { app: logName, hostname: os.hostname(), source: 'nodejs', region: region },
    format: format.json(),
    replaceTimestamp: true,
    onConnectionError: (err) => console.error(err),
  },
}

const getTransports = () => {
  const transports = [new winstonTransports.Console(options.console)]

  if (logToLoki) {
    if (!lokiHost) {
      throw new HttpErrors.InternalServerError('LOKI_HOST required in ENV')
    }

    transports.push(new LokiWinston(options.loki))
  }

  return transports
}

const perEnvTransports = getTransports()

module.exports = createLogger({
  format: format.json(),
  transports: perEnvTransports,
  exitOnError: false,
})
