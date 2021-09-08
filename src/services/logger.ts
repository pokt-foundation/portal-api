import { LogEntry } from 'winston'
import WinstonCloudwatch from 'winston-cloudwatch'
import crypto from 'crypto'
import { HttpErrors } from '@loopback/rest'

require('dotenv').config()

const { createLogger, format, transports: winstonTransports } = require('winston')
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
}

const environment = process.env.NODE_ENV || 'production'
const logToCloudWatch = process.env.LOG_TO_CLOUDWATCH === 'true'
const accessKeyID = process.env.AWS_ACCESS_KEY_ID || ''
const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || ''
const region = process.env.REGION || ''

const timestampUTC = () => {
  const timestamp = new Date()

  return timestamp.toISOString()
}

const consoleFormat = printf(
  ({
    level,
    message,
    requestID,
    relayType,
    typeID,
    serviceNode = '',
    error = '',
    elapsedTime,
    blockchainID = '',
    origin = '',
  }: Log) => {
    return `[${timestampUTC()}] [${level}] [${requestID}] [${relayType}] [${typeID}] [${serviceNode}] [${error}] [${elapsedTime}] [${blockchainID}] [${origin}] ${message}`
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

const logGroup = (process.env.REGION_NAME || '') + '/ecs/gateway'

const options = {
  console: {
    level: 'debug',
    handleExceptions: true,
    colorize: true,
    format: logFormat,
  },
  aws: {
    name: 'cloudwatch-log',
    logGroupName: logGroup,
    logStreamName: function () {
      // Spread log streams across hours as the server stays up
      const date = new Date().toISOString().slice(0, 13)

      return logGroup + '-' + date + '-' + crypto.createHash('md5').update(startTime).digest('hex')
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
}

const getTransports = () => {
  const transports = [new winstonTransports.Console(options.console)]

  if ((environment === 'production' || environment === 'staging') && logToCloudWatch) {
    if (!accessKeyID) {
      throw new HttpErrors.InternalServerError('AWS_ACCESS_KEY_ID required in ENV')
    }
    if (!awsSecretAccessKey) {
      throw new HttpErrors.InternalServerError('AWS_SECRET_ACCESS_KEY required in ENV')
    }
    if (!region) {
      throw new HttpErrors.InternalServerError('REGION required in ENV')
    }

    transports.push(new WinstonCloudwatch(options.aws))
  }

  return transports
}

const perEnvTransports = getTransports()

module.exports = createLogger({
  format: format.json(),
  transports: perEnvTransports,
  exitOnError: false,
})
