import {HttpErrors} from '@loopback/rest';

require("dotenv").config();

const { createLogger, format, transports } = require('winston');
const { printf } = format;
const S3StreamLogger = require('s3-streamlogger').S3StreamLogger;

const s3AccessKeyID: string = process.env.AWS_S3_ACCESS_KEY_ID ?? '';
const s3SecretAccessKey: string = process.env.AWS_S3_SECRET_ACCESS_KEY ?? '';
const s3LogsRegion: string = process.env.AWS_S3_LOGS_REGION ?? '';
const s3LogsBucket: string = process.env.AWS_S3_LOGS_BUCKET ?? '';
const s3LogsFolder: string = process.env.AWS_S3_LOGS_FOLDER ?? '';

if (!s3AccessKeyID) {
  throw new HttpErrors.InternalServerError(
    'AWS_S3_ACCESS_KEY_ID required in ENV',
  );
}
if (!s3SecretAccessKey) {
  throw new HttpErrors.InternalServerError(
    'AWS_S3_SECRET_ACCESS_KEY required in ENV',
  );
}
if (!s3LogsBucket) {
  throw new HttpErrors.InternalServerError(
    'AWS_S3_LOGS_BUCKET required in ENV',
  );
}
if (!s3LogsFolder) {
  throw new HttpErrors.InternalServerError(
    'AWS_S3_LOGS_FOLDER required in ENV',
  );
}

const s3StreamInfo = generateS3Logger('/info');
const s3StreamError = generateS3Logger('/error');
const s3StreamDebug =  generateS3Logger('/debug');

const timestampUTC = () => {
  const timestamp = new Date();
  return timestamp.toISOString();
};

class TimestampFirst {
  enabled: boolean;
  constructor(enabled = true) {
      this.enabled = enabled;
  }
  transform(obj: { timestamp: string; }) {
      if (this.enabled) {
          return Object.assign({
              timestamp: obj.timestamp
          }, obj);
      }
      return obj;
  }
}

var jsonFormat = format.combine(
  format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  new TimestampFirst(true),
  format.json()
);

const consoleFormat = printf(({ level, message, requestID, relayType, typeID, serviceNode, error, elapsedTime }: Log) => {
  return `[${timestampUTC()}] [${level}] [${requestID}] [${relayType}] [${typeID}] [${serviceNode}] [${error}] [${elapsedTime}] ${message}`;
});

const debugFilter = format((log:Log, opts:any) => {
  return log.level === 'debug' ? log : false;
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
  s3Info: {
    level: 'info',
    handleExceptions: true,
    colorize: false,
    stream: s3StreamInfo,
    format: format.combine(
      jsonFormat,
    ),
  },
  s3Error: {
    level: 'error',
    handleExceptions: true,
    colorize: false,
    stream: s3StreamError,
    format: format.combine(
      jsonFormat,
    ),
  },
  s3Debug: {
    level: 'debug',
    handleExceptions: true,
    colorize: false,
    stream: s3StreamDebug,
    format: format.combine(
      debugFilter(),
      jsonFormat,
    ),
  },
};

function generateS3Logger(folder:string): any {
  const s3StreamLogger = new S3StreamLogger({
    bucket: s3LogsBucket,
    folder: s3LogsFolder + folder,
    region: s3LogsRegion,
    // eslint-disable-next-line @typescript-eslint/camelcase
    access_key_id: s3AccessKeyID,
    // eslint-disable-next-line @typescript-eslint/camelcase
    secret_access_key: s3SecretAccessKey,
  });
  
  s3StreamLogger.on('error', function(err: Error){
    console.log('error', 'S3 logging error', err);
  });
  return s3StreamLogger;
}

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
  transports: [
    new transports.Console(options.console),
    new (transports.Stream)(options.s3Info),
    new (transports.Stream)(options.s3Error),
    new (transports.Stream)(options.s3Debug),
  ],
  exitOnError: false,
});