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
    constructor(secretKey, blockchain, aatRepository) {
        this.secretKey = secretKey;
        this.blockchain = blockchain;
        this.aatRepository = aatRepository;
    }
    async create(aat) {
        return this.aatRepository.create(aat);
    }
    async count(where) {
        return this.aatRepository.count(where);
    }
    async find(filter) {
        return this.aatRepository.find(filter);
    }
    async findById(id, filter) {
        return this.aatRepository.findById(id, filter);
    }
    async attemptRelay(id, data, filter) {
        // Construct Pocket AAT from the db record
        const aatRecord = await this.aatRepository.findById(id, filter);
        // Check secretKey; is it required? does it pass?
        // if (secretKey.required)...
        if (this.secretKey !== aatRecord.secretKey) {
            throw new Error("SecretKey does not match");
        }
        // Checks pass; create AAT from db record
        const pocketAAT = new pocket_js_1.PocketAAT(aatRecord.version, aatRecord.clientPubKey, aatRecord.appPubKey, aatRecord.signature);
        // Check the requested blockchain, override if passed in the body
        const blockchainRegex = /^[A-Fa-f0-9]{4}$/;
        if (data.blockchain && blockchainRegex.test(data.blockchain)) {
            this.blockchain = data.blockchain;
        }
        // console.log("Requesting blockchain:", this.blockchain);
        // Create dispatch
        // TODO: caching? per app?
        const dispatchers = new URL("http://localhost:8081");
        const configuration = new pocket_js_1.Configuration(5, 1000, 5, 40000, true);
        const rpcProvider = new pocket_js_1.HttpRpcProvider(dispatchers);
        const pocket = new pocket_js_1.Pocket([dispatchers], rpcProvider, configuration);
        // Unlock primary client account for relay signing
        const clientPrivKey = 'd561ca942e974c541d4999fe2c647f238c22eb42441a472989d2a18a5437a9cfc4553f77697e2dc51ae2b2a7460821dcde8ca876a1b602d13501d9d37584ddfc';
        const importAcct = await pocket.keybase.importAccount(Buffer.from(clientPrivKey, 'hex'), 'pocket');
        const unlockAcct = await pocket.keybase.unlockAccount('d0092305fa8ebf9a97a61d007b878a7840f51900', 'pocket', 0);
        // Send relay and process return: RelayResponse, ConsensusNode, or undefined
        const relayResponse = await pocket.sendRelay(JSON.stringify(data), this.blockchain, pocketAAT, configuration);
        if (relayResponse instanceof pocket_js_1.RelayResponse) {
            return relayResponse.payload;
        }
        else if (relayResponse instanceof pocket_js_1.RpcError) {
            console.log("ERROR", relayResponse.message);
            return relayResponse.message;
        }
        else {
            // TODO: ConsensusNode is a possible return
            throw new Error("relayResponse is undefined");
        }
    }
};
tslib_1.__decorate([
    rest_1.post('/aat', {
        responses: {
            '200': {
                description: 'Aat model instance',
                content: { 'application/json': { schema: rest_1.getModelSchemaRef(models_1.Aat) } },
            },
        },
    }),
    tslib_1.__param(0, rest_1.requestBody({
        content: {
            'application/json': {
                schema: rest_1.getModelSchemaRef(models_1.Aat, {
                    title: 'NewAat',
                }),
            },
        },
    })),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [models_1.Aat]),
    tslib_1.__metadata("design:returntype", Promise)
], V1Controller.prototype, "create", null);
tslib_1.__decorate([
    rest_1.get('/aats/count', {
        responses: {
            '200': {
                description: 'Aat model count',
                content: { 'application/json': { schema: repository_1.CountSchema } },
            },
        },
    }),
    tslib_1.__param(0, rest_1.param.where(models_1.Aat)),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], V1Controller.prototype, "count", null);
tslib_1.__decorate([
    rest_1.get('/aats', {
        responses: {
            '200': {
                description: 'Array of Aat model instances',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: rest_1.getModelSchemaRef(models_1.Aat, { includeRelations: true }),
                        },
                    },
                },
            },
        },
    }),
    tslib_1.__param(0, rest_1.param.filter(models_1.Aat)),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], V1Controller.prototype, "find", null);
tslib_1.__decorate([
    rest_1.get('/v1/{id}', {
        responses: {
            '200': {
                description: 'Aat model instance',
                content: {
                    'application/json': {
                        schema: rest_1.getModelSchemaRef(models_1.Aat, { includeRelations: true }),
                    },
                },
            },
        },
    }),
    tslib_1.__param(0, rest_1.param.path.string('id')),
    tslib_1.__param(1, rest_1.param.filter(models_1.Aat, { exclude: 'where' })),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], V1Controller.prototype, "findById", null);
tslib_1.__decorate([
    rest_1.post('/v1/{id}', {
        responses: {
            '200': {
                description: 'Aat model instance',
                content: {
                    'application/json': {
                        schema: rest_1.getModelSchemaRef(models_1.Aat, { includeRelations: true }),
                    },
                },
            },
        },
    }),
    tslib_1.__param(0, rest_1.param.path.string('id')),
    tslib_1.__param(1, rest_1.requestBody()),
    tslib_1.__param(2, rest_1.param.filter(models_1.Aat, { exclude: 'where' })),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], V1Controller.prototype, "attemptRelay", null);
V1Controller = tslib_1.__decorate([
    tslib_1.__param(0, context_1.inject('secretKey')),
    tslib_1.__param(1, context_1.inject('blockchain')),
    tslib_1.__param(2, repository_1.repository(repositories_1.AatRepository)),
    tslib_1.__metadata("design:paramtypes", [String, String, repositories_1.AatRepository])
], V1Controller);
exports.V1Controller = V1Controller;
//# sourceMappingURL=v1.controller.js.map