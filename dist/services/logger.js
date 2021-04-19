"use strict";
var _a, _b, _c, _d, _e;
Object.defineProperty(exports, "__esModule", { value: true });
const rest_1 = require("@loopback/rest");
require("dotenv").config();
const { createLogger, format, transports } = require('winston');
const { printf } = format;
const S3StreamLogger = require('s3-streamlogger').S3StreamLogger;
const s3AccessKeyID = (_a = process.env.AWS_S3_ACCESS_KEY_ID) !== null && _a !== void 0 ? _a : '';
const s3SecretAccessKey = (_b = process.env.AWS_S3_SECRET_ACCESS_KEY) !== null && _b !== void 0 ? _b : '';
const s3LogsRegion = (_c = process.env.AWS_S3_LOGS_REGION) !== null && _c !== void 0 ? _c : '';
const s3LogsBucket = (_d = process.env.AWS_S3_LOGS_BUCKET) !== null && _d !== void 0 ? _d : '';
const s3LogsFolder = (_e = process.env.AWS_S3_LOGS_FOLDER) !== null && _e !== void 0 ? _e : '';
if (!s3AccessKeyID) {
    throw new rest_1.HttpErrors.InternalServerError('AWS_S3_ACCESS_KEY_ID required in ENV');
}
if (!s3SecretAccessKey) {
    throw new rest_1.HttpErrors.InternalServerError('AWS_S3_SECRET_ACCESS_KEY required in ENV');
}
if (!s3LogsBucket) {
    throw new rest_1.HttpErrors.InternalServerError('AWS_S3_LOGS_BUCKET required in ENV');
}
if (!s3LogsFolder) {
    throw new rest_1.HttpErrors.InternalServerError('AWS_S3_LOGS_FOLDER required in ENV');
}
const s3StreamInfo = generateS3Logger('/info');
const s3StreamError = generateS3Logger('/error');
const s3StreamDebug = generateS3Logger('/debug');
const timestampUTC = () => {
    const timestamp = new Date();
    return timestamp.toISOString();
};
class TimestampFirst {
    constructor(enabled = true) {
        this.enabled = enabled;
    }
    transform(obj) {
        if (this.enabled) {
            return Object.assign({
                timestamp: obj.timestamp
            }, obj);
        }
        return obj;
    }
}
var jsonFormat = format.combine(format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
}), new TimestampFirst(true), format.json());
const consoleFormat = printf(({ level, message, requestID, relayType, typeID, serviceNode, error, elapsedTime }) => {
    return `[${timestampUTC()}] [${level}] [${requestID}] [${relayType}] [${typeID}] [${serviceNode}] [${error}] [${elapsedTime}] ${message}`;
});
const debugFilter = format((log, opts) => {
    return log.level === 'debug' ? log : false;
});
const options = {
    console: {
        level: 'info',
        handleExceptions: true,
        colorize: true,
        format: format.combine(format.colorize(), format.simple(), format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss.SSS',
        }), consoleFormat),
    },
    s3Info: {
        level: 'info',
        handleExceptions: true,
        colorize: false,
        stream: s3StreamInfo,
        format: format.combine(jsonFormat),
    },
    s3Error: {
        level: 'error',
        handleExceptions: true,
        colorize: false,
        stream: s3StreamError,
        format: format.combine(jsonFormat),
    },
    s3Debug: {
        level: 'debug',
        handleExceptions: true,
        colorize: false,
        stream: s3StreamDebug,
        format: format.combine(debugFilter(), jsonFormat),
    },
};
function generateS3Logger(folder) {
    const s3StreamLogger = new S3StreamLogger({
        bucket: s3LogsBucket,
        folder: s3LogsFolder + folder,
        region: s3LogsRegion,
        // eslint-disable-next-line @typescript-eslint/camelcase
        access_key_id: s3AccessKeyID,
        // eslint-disable-next-line @typescript-eslint/camelcase
        secret_access_key: s3SecretAccessKey,
    });
    s3StreamLogger.on('error', function (err) {
        console.log('error', 'S3 logging error', err);
    });
    return s3StreamLogger;
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
//# sourceMappingURL=logger.js.map