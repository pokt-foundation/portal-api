"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const rest_1 = require("@loopback/rest");
const winston_logzio_1 = tslib_1.__importDefault(require("winston-logzio"));
require("dotenv").config();
const { createLogger, format, transports } = require('winston');
const { printf } = format;
const logzToken = (_a = process.env.LOGZ_TOKEN) !== null && _a !== void 0 ? _a : '';
if (!logzToken) {
    throw new rest_1.HttpErrors.InternalServerError('LOGZ_TOKEN required in ENV');
}
const timestampUTC = () => {
    const timestamp = new Date();
    return timestamp.toISOString();
};
const consoleFormat = printf(({ level, message, requestID, relayType, typeID, serviceNode, error, elapsedTime }) => {
    return `[${timestampUTC()}] [${level}] [${requestID}] [${relayType}] [${typeID}] [${serviceNode}] [${error}] [${elapsedTime}] ${message}`;
});
const debugFilter = format((log, opts) => {
    return log.level === 'debug' ? log : false;
});
const logzioWinstonTransport = new winston_logzio_1.default({
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
        format: format.combine(format.colorize(), format.simple(), format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss.SSS',
        }), consoleFormat),
    },
};
module.exports = createLogger({
    format: format.json(),
    transports: [
        new transports.Console(options.console),
        logzioWinstonTransport,
    ],
    exitOnError: false,
});
//# sourceMappingURL=logger.js.map