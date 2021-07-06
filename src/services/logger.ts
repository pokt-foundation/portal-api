import {HttpErrors} from '@loopback/rest';
import LogzioWinstonTransport from 'winston-logzio';

require('dotenv').config();

const { createLogger, format, transports: winstonTransports } = require('winston');
const { printf } = format;

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

const logzToken: string = process.env.LOGZ_TOKEN ?? '';
const environment: string = process.env.NODE_ENV ?? 'production';

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
      consoleFormat,
    ),
  },
  logzio: {
    level: 'debug',
    name: 'winston_logzio',
    token: logzToken,
    host: 'listener-uk.logz.io',
  }
};

const logzioWinstonTransport = new LogzioWinstonTransport(options.logzio);
const consoleWinstonTransport = new winstonTransports.Console(options.console);

const perEnvTransports =
  environment === 'production'
    ? [consoleWinstonTransport, logzioWinstonTransport]
    : [consoleWinstonTransport]

export default createLogger({
  format: format.json(),
  transports: perEnvTransports,
  exitOnError: false,
});
