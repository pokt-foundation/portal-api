"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = exports.PocketGatewayApplication = void 0;
const application_1 = require("./application");
Object.defineProperty(exports, "PocketGatewayApplication", { enumerable: true, get: function () { return application_1.PocketGatewayApplication; } });
const logger = require('./services/logger');
async function main(options = {}) {
    const app = new application_1.PocketGatewayApplication(options);
    await app.boot();
    await app.start();
    await app.loadPocket();
    logger.log('info', `Server is running at ${app.restServer.url}`, { requestID: '', relayType: '', typeID: '', serviceNode: '' });
    return app;
}
exports.main = main;
//# sourceMappingURL=index.js.map