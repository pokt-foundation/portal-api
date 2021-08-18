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

const options = {
  console: {
    level: 'debug',
    handleExceptions: true,
    colorize: true,
    format: format.combine(
      format.colorize(),
      format.simple(),
      format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS',
      }),
      consoleFormat
    ),
  },
}

const getTransports = (env: string) => [new winstonTransports.Console(options.console)]

const perEnvTransports = getTransports(environment)

module.exports = createLogger({
  format: format.json(),
  transports: perEnvTransports,
  exitOnError: false,
})
