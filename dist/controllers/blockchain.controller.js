"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const repository_1 = require("@loopback/repository");
const rest_1 = require("@loopback/rest");
const models_1 = require("../models");
const repositories_1 = require("../repositories");
let BlockchainController = class BlockchainController {
    constructor(blockchainRepository) {
        this.blockchainRepository = blockchainRepository;
    }
    async find(filter) {
        return this.blockchainRepository.find(filter);
    }
};
tslib_1.__decorate([
    rest_1.get('/blockchains', {
        responses: {
            '200': {
                description: 'Array of Blockchain model instances',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: rest_1.getModelSchemaRef(models_1.Blockchain, { includeRelations: true }),
                        },
                    },
                },
            },
        },
    }),
    tslib_1.__param(0, rest_1.param.filter(models_1.Blockchain)),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], BlockchainController.prototype, "find", null);
BlockchainController = tslib_1.__decorate([
    tslib_1.__param(0, repository_1.repository(repositories_1.BlockchainRepository)),
    tslib_1.__metadata("design:paramtypes", [repositories_1.BlockchainRepository])
], BlockchainController);
exports.BlockchainController = BlockchainController;
//# sourceMappingURL=blockchain.controller.js.map