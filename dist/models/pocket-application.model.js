"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const repository_1 = require("@loopback/repository");
let PocketApplication = class PocketApplication extends repository_1.Entity {
    constructor(data) {
        super(data);
    }
};
tslib_1.__decorate([
    repository_1.property({
        type: 'string',
        id: true,
        generated: false,
        required: true,
    }),
    tslib_1.__metadata("design:type", String)
], PocketApplication.prototype, "appPubKey", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'string',
        required: true,
        default: '0.0.1',
    }),
    tslib_1.__metadata("design:type", String)
], PocketApplication.prototype, "version", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'string',
        required: true,
    }),
    tslib_1.__metadata("design:type", String)
], PocketApplication.prototype, "clientPubKey", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'string',
        required: true,
    }),
    tslib_1.__metadata("design:type", String)
], PocketApplication.prototype, "signature", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'string',
        required: true,
    }),
    tslib_1.__metadata("design:type", String)
], PocketApplication.prototype, "secretKey", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'boolean',
        required: true,
        default: false
    }),
    tslib_1.__metadata("design:type", Boolean)
], PocketApplication.prototype, "secretKeyRequired", void 0);
tslib_1.__decorate([
    repository_1.property.array(String),
    tslib_1.__metadata("design:type", Array)
], PocketApplication.prototype, "whitelistOrigins", void 0);
tslib_1.__decorate([
    repository_1.property.array(String),
    tslib_1.__metadata("design:type", Array)
], PocketApplication.prototype, "whitelistAddresses", void 0);
tslib_1.__decorate([
    repository_1.property.array(String),
    tslib_1.__metadata("design:type", Array)
], PocketApplication.prototype, "whitelistUserAgents", void 0);
PocketApplication = tslib_1.__decorate([
    repository_1.model({ settings: { strict: false } }),
    tslib_1.__metadata("design:paramtypes", [Object])
], PocketApplication);
exports.PocketApplication = PocketApplication;
//# sourceMappingURL=pocket-application.model.js.map