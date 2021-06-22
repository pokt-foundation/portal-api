import {HttpErrors} from '@loopback/rest';
import LogzioWinstonTransport from 'winston-logzio';

require("dotenv").config();

const { createLogger, format, transports } = require('winston');
const { printf } = format;

const logzToken: string = process.env.LOGZ_TOKEN ?? '';

if (!logzToken) {
  throw new HttpErrors.InternalServerError(
    'LOGZ_TOKEN required in ENV',
  );
}

const timestampUTC = () => {
  const timestamp = new Date();
  return timestamp.toISOString();
};

const consoleFormat = printf(({ level, message, requestID, relayType, typeID, serviceNode, error, elapsedTime }: Log) => {
  return `[${timestampUTC()}] [${level}] [${requestID}] [${relayType}] [${typeID}] [${serviceNode}] [${error}] [${elapsedTime}] ${message}`;
});

const debugFilter = format((log:Log, opts:any) => {
  return log.level === 'debug' ? log : false;
});

const logzioWinstonTransport = new LogzioWinstonTransport({
  level: 'info',
  name: 'winston_logzio',
  token: logzToken,
  host: 'listener-uk.logz.io',
});

const options = {
  console: {
    level: 'info',
    handleExceptions: true,
    colorize: true,
    format: format.combine(
      format.colorize(),
      format.simple(),
      format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS',
      }),
      consoleFormat,
    ),
  },
};

interface Log {
  level: string;
  message: string;
  requestID: string;
  relayType: string;
  typeID: string;
  serviceNode: string;
  error: string | undefined;
  elapsedTime: number;
}

module.exports = createLogger({
  format: format.json(),
  transports: [
    new transports.Console(options.console),
    logzioWinstonTransport,
  ],
  exitOnError: false,
});