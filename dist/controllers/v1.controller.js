"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const context_1 = require("@loopback/context");
const repository_1 = require("@loopback/repository");
const rest_1 = require("@loopback/rest");
const models_1 = require("../models");
const repositories_1 = require("../repositories");
const pocket_js_1 = require("@pokt-network/pocket-js");
const pg_1 = require("pg");
var pgFormat = require("pg-format");
let V1Controller = class V1Controller {
    constructor(secretKey, host, origin, userAgent, pocket, pocketConfiguration, redis, pgPool, processUID, pocketApplicationRepository, blockchainRepository) {
        this.secretKey = secretKey;
        this.host = host;
        this.origin = origin;
        this.userAgent = userAgent;
        this.pocket = pocket;
        this.pocketConfiguration = pocketConfiguration;
        this.redis = redis;
        this.pgPool = pgPool;
        this.processUID = processUID;
        this.pocketApplicationRepository = pocketApplicationRepository;
        this.blockchainRepository = blockchainRepository;
    }
    async attemptRelay(id, data, filter) {
        console.log("PROCESSING " + id + " host: " + this.host + " req: " + JSON.stringify(data));
        const elapsedStart = process.hrtime();
        // Load the requested blockchain
        const cachedBlockchains = await this.redis.get("blockchains");
        let blockchains, blockchain;
        if (!cachedBlockchains) {
            blockchains = await this.blockchainRepository.find();
            this.redis.set("blockchains", JSON.stringify(blockchains), "EX", 1);
        }
        else {
            blockchains = JSON.parse(cachedBlockchains);
        }
        // Split off the first part of the request's host and check for matches
        const blockchainRequest = this.host.split(".")[0];
        const blockchainFilter = blockchains.filter((b) => b.blockchain.toLowerCase() === blockchainRequest.toLowerCase());
        if (blockchainFilter[0]) {
            blockchain = blockchainFilter[0].hash;
        }
        else {
            throw new rest_1.HttpErrors.BadRequest("Incorrect blockchain: " + this.host);
        }
        // Construct Pocket AAT from cache; if not available, use the db
        const cachedApp = await this.redis.get(id);
        let app;
        if (!cachedApp) {
            app = await this.pocketApplicationRepository.findById(id, filter);
            this.redis.set(id, JSON.stringify(app), "EX", 60);
        }
        else {
            app = JSON.parse(cachedApp);
        }
        // Check secretKey; is it required? does it pass?
        if (app.secretKeyRequired && this.secretKey !== app.secretKey) {
            throw new rest_1.HttpErrors.Forbidden("SecretKey does not match");
        }
        // Whitelist: origins -- explicit matches
        if (!this.checkWhitelist(app.whitelistOrigins, this.origin, "explicit")) {
            throw new rest_1.HttpErrors.Forbidden("Whitelist Origin check failed: " + this.origin);
        }
        // Whitelist: userAgent -- substring matches
        if (!this.checkWhitelist(app.whitelistUserAgents, this.userAgent, "substring")) {
            throw new rest_1.HttpErrors.Forbidden("Whitelist User Agent check failed: " + this.userAgent);
        }
        // Checks pass; create AAT from db record
        const pocketAAT = new pocket_js_1.PocketAAT(app.version, app.clientPubKey, app.appPubKey, app.signature);
        // Pull a specific node for this relay
        let node;
        const pocketSession = await this.pocket.sessionManager.getCurrentSession(pocketAAT, blockchain, this.pocketConfiguration);
        if (pocketSession instanceof pocket_js_1.Session) {
            /*
            pocketSession.sessionNodes.forEach(function (node, index) {
              console.log(node.publicKey + " - " + node.serviceURL.hostname);
            });
            */
            node =
                pocketSession.sessionNodes[Math.floor(Math.random() * pocketSession.sessionNodes.length)];
            // console.log("CHOSEN: " + node.publicKey);
        }
        // Send relay and process return: RelayResponse, RpcError, ConsensusNode, or undefined
        const relayResponse = await this.pocket.sendRelay(JSON.stringify(data), blockchain, pocketAAT, this.pocketConfiguration, undefined, undefined, undefined, node);
        // Success
        if (relayResponse instanceof pocket_js_1.RelayResponse) {
            console.log("SUCCESS " + id + " chain: " + blockchain + " req: " + JSON.stringify(data) + " res: " + relayResponse.payload);
            const bytes = Buffer.byteLength(relayResponse.payload, 'utf8');
            this.recordMetric({
                appPubKey: app.appPubKey,
                blockchain,
                serviceNode: relayResponse.proof.servicePubKey,
                elapsedStart,
                result: 200,
                bytes,
            });
            return relayResponse.payload;
        }
        // Error
        else if (relayResponse instanceof pocket_js_1.RpcError) {
            console.log("ERROR " + id + " chain: " + blockchain + " req: " + JSON.stringify(data) + " res: " + relayResponse.message);
            console.log(relayResponse);
            const bytes = Buffer.byteLength(relayResponse.message, 'utf8');
            this.recordMetric({
                appPubKey: app.appPubKey,
                blockchain,
                serviceNode: node === null || node === void 0 ? void 0 : node.publicKey,
                elapsedStart,
                result: 500,
                bytes,
            });
            throw new rest_1.HttpErrors.InternalServerError(relayResponse.message);
        }
        // ConsensusNode
        else {
            // TODO: ConsensusNode is a possible return
            throw new rest_1.HttpErrors.InternalServerError("relayResponse is undefined");
        }
    }
    // Record relay metrics in redis then push to timescaleDB for analytics
    async recordMetric({ appPubKey, blockchain, serviceNode, elapsedStart, result, bytes, }) {
        try {
            const elapsedEnd = process.hrtime(elapsedStart);
            const elapsedTime = (elapsedEnd[0] * 1e9 + elapsedEnd[1]) / 1e9;
            const metricsValues = [
                new Date(),
                appPubKey,
                blockchain,
                serviceNode,
                elapsedTime,
                result,
                bytes,
            ];
            // Store metrics in redis and every 10 seconds, push to postgres
            const redisMetricsKey = "metrics-" + this.processUID;
            const redisListAge = await this.redis.get("age-" + redisMetricsKey);
            const redisListSize = await this.redis.llen(redisMetricsKey);
            const redisTimestamp = Math.floor(new Date().getTime() / 1000);
            // List has been started in redis and needs to be pushed as timestamp is > 10 seconds old
            if (redisListAge &&
                redisListSize > 0 &&
                redisTimestamp > parseInt(redisListAge) + 10) {
                let bulkData = [];
                for (let count = 0; count < redisListSize; count++) {
                    const redisRecord = await this.redis.lpop(redisMetricsKey);
                    bulkData.push(JSON.parse(redisRecord));
                }
                const metricsQuery = pgFormat("INSERT INTO relay VALUES %L RETURNING *", bulkData);
                this.pgPool.query(metricsQuery);
                await this.redis.unlink("age-" + redisMetricsKey);
            }
            else if (!redisListAge) {
                await this.redis.set("age-" + redisMetricsKey, redisTimestamp);
            }
            this.redis.rpush(redisMetricsKey, JSON.stringify(metricsValues));
        }
        catch (err) {
            console.log(err.stack);
        }
    }
    checkWhitelist(tests, check, type) {
        if (tests.length === 0) {
            return true;
        }
        if (!check) {
            return false;
        }
        for (var test of tests) {
            if (type === "explicit") {
                if (test.toLowerCase() === check.toLowerCase()) {
                    return true;
                }
            }
            else {
                if (check.toLowerCase().includes(test.toLowerCase())) {
                    return true;
                }
            }
        }
        return false;
    }
};
tslib_1.__decorate([
    rest_1.post("/v1/{id}", {
        responses: {
            "200": {
                description: "Relay Response",
                content: {
                    "application/json": {},
                },
            },
        },
    }),
    tslib_1.__param(0, rest_1.param.path.string("id")),
    tslib_1.__param(1, rest_1.requestBody()),
    tslib_1.__param(2, rest_1.param.filter(models_1.PocketApplication, { exclude: "where" })),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], V1Controller.prototype, "attemptRelay", null);
V1Controller = tslib_1.__decorate([
    tslib_1.__param(0, context_1.inject("secretKey")),
    tslib_1.__param(1, context_1.inject("host")),
    tslib_1.__param(2, context_1.inject("origin")),
    tslib_1.__param(3, context_1.inject("userAgent")),
    tslib_1.__param(4, context_1.inject("pocketInstance")),
    tslib_1.__param(5, context_1.inject("pocketConfiguration")),
    tslib_1.__param(6, context_1.inject("redisInstance")),
    tslib_1.__param(7, context_1.inject("pgPool")),
    tslib_1.__param(8, context_1.inject("processUID")),
    tslib_1.__param(9, repository_1.repository(repositories_1.PocketApplicationRepository)),
    tslib_1.__param(10, repository_1.repository(repositories_1.BlockchainRepository)),
    tslib_1.__metadata("design:paramtypes", [String, String, String, String, pocket_js_1.Pocket,
        pocket_js_1.Configuration, Object, pg_1.Pool, String, repositories_1.PocketApplicationRepository,
        repositories_1.BlockchainRepository])
], V1Controller);
exports.V1Controller = V1Controller;
//# sourceMappingURL=v1.controller.js.map