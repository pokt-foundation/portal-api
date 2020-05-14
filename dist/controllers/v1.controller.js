"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const context_1 = require("@loopback/context");
const repository_1 = require("@loopback/repository");
const rest_1 = require("@loopback/rest");
const models_1 = require("../models");
const repositories_1 = require("../repositories");
const pocket_js_1 = require("@pokt-network/pocket-js");
let V1Controller = class V1Controller {
    constructor(secretKey, blockchain, origin, userAgent, pocket, redis, pocketApplicationRepository) {
        this.secretKey = secretKey;
        this.blockchain = blockchain;
        this.origin = origin;
        this.userAgent = userAgent;
        this.pocket = pocket;
        this.redis = redis;
        this.pocketApplicationRepository = pocketApplicationRepository;
    }
    async attemptRelay(id, data, filter) {
        console.log("PROCESSING " + id + " chain: " + this.blockchain + " req: " + JSON.stringify(data));
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
        // Whitelist: contracts
        // Checks pass; create AAT from db record
        const pocketAAT = new pocket_js_1.PocketAAT(app.version, app.clientPubKey, app.appPubKey, app.signature);
        // Check the requested blockchain, override if passed in the body
        const blockchainRegex = /^[A-Fa-f0-9]{4}$/;
        if (data.blockchain && blockchainRegex.test(data.blockchain)) {
            this.blockchain = data.blockchain;
        }
        // Send relay and process return: RelayResponse, RpcError, ConsensusNode, or undefined
        const relayResponse = await this.pocket.sendRelay(JSON.stringify(data), this.blockchain, pocketAAT);
        // Success
        if (relayResponse instanceof pocket_js_1.RelayResponse) {
            console.log("SUCCESS " + id + " chain: " + this.blockchain + " req: " + JSON.stringify(data) + " res: " + relayResponse.payload);
            return relayResponse.payload;
        }
        // Error
        else if (relayResponse instanceof pocket_js_1.RpcError) {
            console.log("ERROR " + id + " chain: " + this.blockchain + " req: " + JSON.stringify(data) + " res: " + relayResponse.message);
            throw new rest_1.HttpErrors.InternalServerError(relayResponse.message);
        }
        // ConsensusNode
        else {
            // TODO: ConsensusNode is a possible return
            throw new rest_1.HttpErrors.InternalServerError("relayResponse is undefined");
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
    rest_1.post('/v1/{id}', {
        responses: {
            '200': {
                description: 'Relay Response',
                content: {
                    'application/json': {},
                },
            },
        },
    }),
    tslib_1.__param(0, rest_1.param.path.string('id')),
    tslib_1.__param(1, rest_1.requestBody()),
    tslib_1.__param(2, rest_1.param.filter(models_1.PocketApplication, { exclude: 'where' })),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], V1Controller.prototype, "attemptRelay", null);
V1Controller = tslib_1.__decorate([
    tslib_1.__param(0, context_1.inject('secretKey')),
    tslib_1.__param(1, context_1.inject('blockchain')),
    tslib_1.__param(2, context_1.inject('origin')),
    tslib_1.__param(3, context_1.inject('userAgent')),
    tslib_1.__param(4, context_1.inject('pocketInstance')),
    tslib_1.__param(5, context_1.inject('redisInstance')),
    tslib_1.__param(6, repository_1.repository(repositories_1.PocketApplicationRepository)),
    tslib_1.__metadata("design:paramtypes", [String, String, String, String, pocket_js_1.Pocket, Object, repositories_1.PocketApplicationRepository])
], V1Controller);
exports.V1Controller = V1Controller;
//# sourceMappingURL=v1.controller.js.map