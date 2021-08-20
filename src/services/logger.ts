import { string } from 'pg-format'
import { LogEntry } from 'winston'
import WinstonCloudwatch from 'winston-cloudwatch'
import crypto from 'crypto'

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
}

const environment: string = process.env.NODE_ENV || 'production'

const timestampUTC = () => {
  const timestamp = new Date()

  return timestamp.toISOString()
}

const consoleFormat = printf(
  ({ level, message, requestID, relayType, typeID, serviceNode, error, elapsedTime }: Log) => {
    return `[${timestampUTC()}] [${level}] [${requestID}] [${relayType}] [${typeID}] [${serviceNode}] [${error}] [${elapsedTime}] ${message}`
  }
)

const startTime = new Date().toISOString()

const awsFormat = (
  level: string,
  message: string,
  { requestID, relayType, typeID, serviceNode, error, elapsedTime }: Log
) =>
  `[${timestampUTC()}] [${level}] [${requestID}] [${relayType}] [${typeID}] [${serviceNode}] [${error}] [${elapsedTime}] ${message}`

const logFormat = format.combine(
  format.colorize(),
  format.simple(),
  format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS',
  }),
  consoleFormat
)

const logGroup = `${process.env.REGION_NAME || ''}/ecs/gateway`

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
      // Spread log streams across dates as the server stays up
      const date = new Date().toISOString().split('T')[0]

      return logGroup + date + '-' + crypto.createHash('md5').update(startTime).digest('hex')
    },
    awsRegion: process.env.REGION,
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
    awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY,
    level: 'verbose',
    messageFormatter: (logObject: LogEntry) => {
      const { level, requestID, relayType, typeID, serviceNode, error, elapsedTime, message } = logObject

      return JSON.stringify({
        timestamp: timestampUTC(),
        level,
        requestID,
        relayType,
        typeID,
        serviceNode,
        error,
        elapsedTime,
        message,
      })
    },
  },
}

const getTransports = (env: string) => {
  const transports = [new winstonTransports.Console(options.console)]

  if (environment === 'production') {
    transports.push(new WinstonCloudwatch(options.aws))
  }

  return transports
}

const perEnvTransports = getTransports(environment)

module.exports = createLogger({
  format: format.json(),
  transports: perEnvTransports,
  exitOnError: false,
})
