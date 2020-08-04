"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const repository_1 = require("@loopback/repository");
let Aat = class Aat extends repository_1.Entity {
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
], Aat.prototype, "appPubKey", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'string',
        required: true,
        default: '0.0.1',
    }),
    tslib_1.__metadata("design:type", String)
], Aat.prototype, "version", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'string',
        required: true,
    }),
    tslib_1.__metadata("design:type", String)
], Aat.prototype, "clientPubKey", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'string',
        required: true,
    }),
    tslib_1.__metadata("design:type", String)
], Aat.prototype, "signature", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'string',
        required: true,
    }),
    tslib_1.__metadata("design:type", String)
], Aat.prototype, "secretKey", void 0);
Aat = tslib_1.__decorate([
    repository_1.model({ settings: { strict: false } }),
    tslib_1.__metadata("design:paramtypes", [Object])
], Aat);
exports.Aat = Aat;
//# sourceMappingURL=aat.model.js.map