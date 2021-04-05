"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const boot_1 = require("@loopback/boot");
const repository_1 = require("@loopback/repository");
const rest_1 = require("@loopback/rest");
const service_proxy_1 = require("@loopback/service-proxy");
const sequence_1 = require("./sequence");
const path_1 = tslib_1.__importDefault(require("path"));
const logger = require('./services/logger');
const Redis = require('ioredis');
const crypto = require('crypto');
const os = require('os');
const process = require('process');
const pg = require('pg');
const got = require('got');
;
require('log-timestamp');
require('dotenv').config();
class PocketGatewayApplication extends boot_1.BootMixin(service_proxy_1.ServiceMixin(repository_1.RepositoryMixin(rest_1.RestApplication))) {
    constructor(options = {}) {
        super(options);
        this.sequence(sequence_1.GatewaySequence);
        this.static('/', path_1.default.join(__dirname, '../public'));
        this.projectRoot = __dirname;
        this.bootOptions = {
            controllers: {
                dirs: ['controllers'],
                extensions: ['.controller.js'],
                nested: true,
            },
        };
    }
    async loadApp() {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        // Requirements; for Production these are stored in GitHub repo secrets
        //
        // For Dev, you need to pass them in via .env file
        const dispatchURL = (_a = process.env.DISPATCH_URL) !== null && _a !== void 0 ? _a : '';
        const fallbackURL = (_b = process.env.FALLBACK_URL) !== null && _b !== void 0 ? _b : '';
        const clientPrivateKey = (_c = process.env.GATEWAY_CLIENT_PRIVATE_KEY) !== null && _c !== void 0 ? _c : '';
        const clientPassphrase = (_d = process.env.GATEWAY_CLIENT_PASSPHRASE) !== null && _d !== void 0 ? _d : '';
        const pocketSessionBlockFrequency = (_e = parseInt(process.env.POCKET_SESSION_BLOCK_FREQUENCY)) !== null && _e !== void 0 ? _e : 0;
        const pocketBlockTime = (_f = parseInt(process.env.POCKET_BLOCK_TIME)) !== null && _f !== void 0 ? _f : 0;
        const relayRetries = (_g = parseInt(process.env.POCKET_RELAY_RETRIES)) !== null && _g !== void 0 ? _g : 0;
        const databaseEncryptionKey = (_h = process.env.DATABASE_ENCRYPTION_KEY) !== null && _h !== void 0 ? _h : '';
        if (!dispatchURL) {
            throw new rest_1.HttpErrors.InternalServerError('DISPATCH_URL required in ENV');
        }
        if (!fallbackURL) {
            throw new rest_1.HttpErrors.InternalServerError('FALLBACK_URL required in ENV');
        }
        if (!clientPrivateKey) {
            throw new rest_1.HttpErrors.InternalServerError('GATEWAY_CLIENT_PRIVATE_KEY required in ENV');
        }
        if (!clientPassphrase) {
            throw new rest_1.HttpErrors.InternalServerError('GATEWAY_CLIENT_PASSPHRASE required in ENV');
        }
        if (!pocketSessionBlockFrequency || pocketSessionBlockFrequency === 0) {
            throw new rest_1.HttpErrors.InternalServerError('POCKET_SESSION_BLOCK_FREQUENCY required in ENV');
        }
        if (!pocketBlockTime || pocketBlockTime === 0) {
            throw new rest_1.HttpErrors.InternalServerError('POCKET_BLOCK_TIME required in ENV');
        }
        if (!databaseEncryptionKey) {
            throw new rest_1.HttpErrors.InternalServerError('DATABASE_ENCRYPTION_KEY required in ENV');
        }
        this.bind('dispatchURL').to(dispatchURL);
        this.bind('pocketSessionBlockFrequency').to(pocketSessionBlockFrequency);
        this.bind('pocketBlockTime').to(pocketBlockTime);
        this.bind('clientPrivateKey').to(clientPrivateKey);
        this.bind('clientPassphrase').to(clientPassphrase);
        this.bind('relayRetries').to(relayRetries);
        this.bind('fallbackURL').to(fallbackURL);
        this.bind('logger').to(logger);
        // Load Redis for cache
        const redisEndpoint = process.env.REDIS_ENDPOINT || '';
        const redisPort = process.env.REDIS_PORT || '';
        if (!redisEndpoint) {
            throw new rest_1.HttpErrors.InternalServerError('REDIS_ENDPOINT required in ENV');
        }
        if (!redisPort) {
            throw new rest_1.HttpErrors.InternalServerError('REDIS_PORT required in ENV');
        }
        const redis = new Redis(redisPort, redisEndpoint);
        this.bind('redisInstance').to(redis);
        // Load Postgres for TimescaleDB metrics
        const pgConnection = process.env.PG_CONNECTION || '';
        const pgCertificate = process.env.PG_CERTIFICATE || '';
        if (!pgConnection) {
            throw new rest_1.HttpErrors.InternalServerError('PG_CONNECTION required in ENV');
        }
        if (!pgCertificate) {
            throw new rest_1.HttpErrors.InternalServerError('PG_CERTIFICATE required in ENV');
        }
        // Pull public certificate from Redis or s3 if not there
        const cachedCertificate = await redis.get('timescaleDBCertificate');
        let publicCertificate;
        if (!cachedCertificate) {
            try {
                const s3Certificate = await got(pgCertificate);
                publicCertificate = s3Certificate.body;
            }
            catch (e) {
                throw new rest_1.HttpErrors.InternalServerError('Invalid Certificate');
            }
            redis.set('timescaleDBCertificate', publicCertificate, 'EX', 600);
        }
        else {
            publicCertificate = cachedCertificate;
        }
        const pgPool = new pg.Pool({
            connectionString: pgConnection,
            ssl: {
                rejectUnauthorized: false,
                ca: publicCertificate,
            },
        });
        this.bind('pgPool').to(pgPool);
        this.bind('databaseEncryptionKey').to(databaseEncryptionKey);
        // Create a UID for this process
        const parts = [os.hostname(), process.pid, +new Date()];
        const hash = crypto.createHash('md5').update(parts.join(''));
        this.bind('processUID').to(hash.digest('hex'));
        // Load an empty array to store PocketJS instances
        const pocketJSInstances = {};
        this.bind('pocketJSInstances').to(pocketJSInstances);
    }
}
exports.PocketGatewayApplication = PocketGatewayApplication;
//# sourceMappingURL=application.js.map