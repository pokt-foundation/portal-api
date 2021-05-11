"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GatewayDataSource = void 0;
const tslib_1 = require("tslib");
const core_1 = require("@loopback/core");
const repository_1 = require("@loopback/repository");
const rest_1 = require("@loopback/rest");
const mongoEndpoint = (_a = process.env.MONGO_ENDPOINT) !== null && _a !== void 0 ? _a : '';
if (!mongoEndpoint) {
    throw new rest_1.HttpErrors.InternalServerError('MONGO_ENDPOINT required in ENV');
}
const config = {
    name: 'gateway',
    connector: 'mongodb',
    url: mongoEndpoint,
    useNewUrlParser: true,
    useUnifiedTopology: true,
};
// Observe application's life cycle to disconnect the datasource when
// application is stopped. This allows the application to be shut down
// gracefully. The `stop()` method is inherited from `juggler.DataSource`.
// Learn more at https://loopback.io/doc/en/lb4/Life-cycle.html
let GatewayDataSource = class GatewayDataSource extends repository_1.juggler.DataSource {
    constructor(dsConfig = config) {
        super(dsConfig);
    }
};
GatewayDataSource.dataSourceName = 'gateway';
GatewayDataSource.defaultConfig = config;
GatewayDataSource = tslib_1.__decorate([
    core_1.lifeCycleObserver('datasource'),
    tslib_1.__param(0, core_1.inject('datasources.config.gateway', { optional: true })),
    tslib_1.__metadata("design:paramtypes", [Object])
], GatewayDataSource);
exports.GatewayDataSource = GatewayDataSource;
//# sourceMappingURL=gateway.datasource.js.map