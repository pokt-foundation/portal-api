"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const repository_1 = require("@loopback/repository");
let LoadBalancers = class LoadBalancers extends repository_1.Entity {
    constructor(data) {
        super(data);
    }
};
tslib_1.__decorate([
    repository_1.property({
        type: 'string',
        id: true,
        generated: true,
    }),
    tslib_1.__metadata("design:type", String)
], LoadBalancers.prototype, "id", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'string',
        required: true,
    }),
    tslib_1.__metadata("design:type", String)
], LoadBalancers.prototype, "user", void 0);
tslib_1.__decorate([
    repository_1.property({
        type: 'array',
        itemType: 'string',
        required: true,
    }),
    tslib_1.__metadata("design:type", Array)
], LoadBalancers.prototype, "applicationIDs", void 0);
LoadBalancers = tslib_1.__decorate([
    repository_1.model({ settings: { strict: false } }),
    tslib_1.__metadata("design:paramtypes", [Object])
], LoadBalancers);
exports.LoadBalancers = LoadBalancers;
//# sourceMappingURL=load-balancers.model.js.map