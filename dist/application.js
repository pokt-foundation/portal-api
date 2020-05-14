"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const boot_1 = require("@loopback/boot");
const repository_1 = require("@loopback/repository");
const rest_1 = require("@loopback/rest");
const service_proxy_1 = require("@loopback/service-proxy");
const sequence_1 = require("./sequence");
const account_1 = require("@pokt-network/pocket-js/lib/src/keybase/models/account");
const path_1 = tslib_1.__importDefault(require("path"));
const pocket_js_1 = require("@pokt-network/pocket-js");
var Redis = require('ioredis');
require('log-timestamp');
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
    async loadPocket() {
        // Requirements; for Production these are stored in AWS Secrets Manager in the
        // corresponding region of the container.
        //
        // For Dev, you need to pass them in via command line before npm start or 
        // via docker run
        //
        // TODO: change to https when infra is finished
        const dispatchURL = process.env.DISPATCH_URL || "";
        const clientPrivateKey = process.env.CLIENT_PRIVATE_KEY || "";
        const clientPassphrase = process.env.CLIENT_PASSPHRASE || "";
        if (!dispatchURL) {
            throw new rest_1.HttpErrors.InternalServerError("DISPATCH_URL required in ENV");
        }
        if (!clientPrivateKey) {
            throw new rest_1.HttpErrors.InternalServerError("CLIENT_PRIVATE_KEY required in ENV");
        }
        if (!clientPassphrase) {
            throw new rest_1.HttpErrors.InternalServerError("CLIENT_PASSPHRASE required in ENV");
        }
        // Create the Pocket instance
        const dispatchers = new URL(dispatchURL);
        const configuration = new pocket_js_1.Configuration(5, 1000, 5, 40000, true);
        const rpcProvider = new pocket_js_1.HttpRpcProvider(dispatchers);
        const pocket = new pocket_js_1.Pocket([dispatchers], rpcProvider, configuration);
        // Bind to application context for shared re-use
        this.bind("pocketInstance").to(pocket);
        // Unlock primary client account for relay signing
        try {
            const importAccount = await pocket.keybase.importAccount(Buffer.from(clientPrivateKey, 'hex'), clientPassphrase);
            if (importAccount instanceof account_1.Account) {
                await pocket.keybase.unlockAccount(importAccount.addressHex, clientPassphrase, 0);
            }
        }
        catch (e) {
            console.log(e);
            throw new rest_1.HttpErrors.InternalServerError("Unable to import or unlock base client account");
        }
        // Load Redis for cache
        const redisEndpoint = process.env.REDIS_ENDPOINT || "";
        const redisPort = process.env.REDIS_PORT || "";
        if (!redisEndpoint) {
            throw new rest_1.HttpErrors.InternalServerError("REDIS_ENDPOINT required in ENV");
        }
        if (!redisPort) {
            throw new rest_1.HttpErrors.InternalServerError("REDIS_PORT required in ENV");
        }
        const redis = new Redis(redisPort, redisEndpoint);
        this.bind("redisInstance").to(redis);
    }
}
exports.PocketGatewayApplication = PocketGatewayApplication;
//# sourceMappingURL=application.js.map