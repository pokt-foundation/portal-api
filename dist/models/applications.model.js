"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Applications = void 0;
const tslib_1 = require("tslib");
const repository_1 = require("@loopback/repository");
let Applications = class Applications extends repository_1.Entity {
    constructor(data) {
        super(data);
    }
};
tslib_1.__decorate([
    repository_1.property({
        type: 'string',
        id: true,
        generated: true,
        required: true,
    }),
    tslib_1.__metadata("design:type", String)
], Applications.prototype, "id", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'string',
    }),
    tslib_1.__metadata("design:type", String)
], Applications.prototype, "name", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'string',
    }),
    tslib_1.__metadata("design:type", String)
], Applications.prototype, "owner", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'string',
    }),
    tslib_1.__metadata("design:type", String)
], Applications.prototype, "url", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'boolean',
        required: true,
    }),
    tslib_1.__metadata("design:type", Boolean)
], Applications.prototype, "freeTier", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'object',
    }),
    tslib_1.__metadata("design:type", Object)
], Applications.prototype, "publicPocketAccount", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'object',
    }),
    tslib_1.__metadata("design:type", Object)
], Applications.prototype, "freeTierApplicationAccount", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'object',
    }),
    tslib_1.__metadata("design:type", Object)
], Applications.prototype, "aat", void 0);
Applications = tslib_1.__decorate([
    repository_1.model({ settings: { strict: false } }),
    tslib_1.__metadata("design:paramtypes", [Object])
], Applications);
exports.Applications = Applications;
//# sourceMappingURL=applications.model.js.map