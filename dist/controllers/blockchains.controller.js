"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlockchainsController = void 0;
const tslib_1 = require("tslib");
const repository_1 = require("@loopback/repository");
const rest_1 = require("@loopback/rest");
const models_1 = require("../models");
const repositories_1 = require("../repositories");
let BlockchainsController = class BlockchainsController {
    constructor(blockchainsRepository) {
        this.blockchainsRepository = blockchainsRepository;
    }
    async create(blockchains) {
        return this.blockchainsRepository.create(blockchains);
    }
    async count(where) {
        return this.blockchainsRepository.count(where);
    }
    async find(filter) {
        return this.blockchainsRepository.find(filter);
    }
    async updateAll(blockchains, where) {
        return this.blockchainsRepository.updateAll(blockchains, where);
    }
    async findById(id, filter) {
        return this.blockchainsRepository.findById(id, filter);
    }
    async updateById(id, blockchains) {
        await this.blockchainsRepository.updateById(id, blockchains);
    }
    async replaceById(id, blockchains) {
        await this.blockchainsRepository.replaceById(id, blockchains);
    }
    async deleteById(id) {
        await this.blockchainsRepository.deleteById(id);
    }
};
tslib_1.__decorate([
    rest_1.post('/blockchains', {
        responses: {
            '200': {
                description: 'Blockchains model instance',
                content: { 'application/json': { schema: rest_1.getModelSchemaRef(models_1.Blockchains) } },
            },
        },
    }),
    tslib_1.__param(0, rest_1.requestBody({
        content: {
            'application/json': {
                schema: rest_1.getModelSchemaRef(models_1.Blockchains, {
                    title: 'NewBlockchains',
                }),
            },
        },
    })),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [models_1.Blockchains]),
    tslib_1.__metadata("design:returntype", Promise)
], BlockchainsController.prototype, "create", null);
tslib_1.__decorate([
    rest_1.get('/blockchains/count', {
        responses: {
            '200': {
                description: 'Blockchains model count',
                content: { 'application/json': { schema: repository_1.CountSchema } },
            },
        },
    }),
    tslib_1.__param(0, rest_1.param.where(models_1.Blockchains)),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], BlockchainsController.prototype, "count", null);
tslib_1.__decorate([
    rest_1.get('/blockchains', {
        responses: {
            '200': {
                description: 'Array of Blockchains model instances',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: rest_1.getModelSchemaRef(models_1.Blockchains, { includeRelations: true }),
                        },
                    },
                },
            },
        },
    }),
    tslib_1.__param(0, rest_1.param.filter(models_1.Blockchains)),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], BlockchainsController.prototype, "find", null);
tslib_1.__decorate([
    rest_1.patch('/blockchains', {
        responses: {
            '200': {
                description: 'Blockchains PATCH success count',
                content: { 'application/json': { schema: repository_1.CountSchema } },
            },
        },
    }),
    tslib_1.__param(0, rest_1.requestBody({
        content: {
            'application/json': {
                schema: rest_1.getModelSchemaRef(models_1.Blockchains, { partial: true }),
            },
        },
    })),
    tslib_1.__param(1, rest_1.param.where(models_1.Blockchains)),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [models_1.Blockchains, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], BlockchainsController.prototype, "updateAll", null);
tslib_1.__decorate([
    rest_1.get('/blockchains/{id}', {
        responses: {
            '200': {
                description: 'Blockchains model instance',
                content: {
                    'application/json': {
                        schema: rest_1.getModelSchemaRef(models_1.Blockchains, { includeRelations: true }),
                    },
                },
            },
        },
    }),
    tslib_1.__param(0, rest_1.param.path.string('id')),
    tslib_1.__param(1, rest_1.param.filter(models_1.Blockchains, { exclude: 'where' })),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], BlockchainsController.prototype, "findById", null);
tslib_1.__decorate([
    rest_1.patch('/blockchains/{id}', {
        responses: {
            '204': {
                description: 'Blockchains PATCH success',
            },
        },
    }),
    tslib_1.__param(0, rest_1.param.path.string('id')),
    tslib_1.__param(1, rest_1.requestBody({
        content: {
            'application/json': {
                schema: rest_1.getModelSchemaRef(models_1.Blockchains, { partial: true }),
            },
        },
    })),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, models_1.Blockchains]),
    tslib_1.__metadata("design:returntype", Promise)
], BlockchainsController.prototype, "updateById", null);
tslib_1.__decorate([
    rest_1.put('/blockchains/{id}', {
        responses: {
            '204': {
                description: 'Blockchains PUT success',
            },
        },
    }),
    tslib_1.__param(0, rest_1.param.path.string('id')),
    tslib_1.__param(1, rest_1.requestBody()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, models_1.Blockchains]),
    tslib_1.__metadata("design:returntype", Promise)
], BlockchainsController.prototype, "replaceById", null);
tslib_1.__decorate([
    rest_1.del('/blockchains/{id}', {
        responses: {
            '204': {
                description: 'Blockchains DELETE success',
            },
        },
    }),
    tslib_1.__param(0, rest_1.param.path.string('id')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], BlockchainsController.prototype, "deleteById", null);
BlockchainsController = tslib_1.__decorate([
    tslib_1.__param(0, repository_1.repository(repositories_1.BlockchainsRepository)),
    tslib_1.__metadata("design:paramtypes", [repositories_1.BlockchainsRepository])
], BlockchainsController);
exports.BlockchainsController = BlockchainsController;
//# sourceMappingURL=blockchains.controller.js.map