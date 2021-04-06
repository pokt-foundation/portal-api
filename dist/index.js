"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const application_1 = require("./application");
exports.PocketGatewayApplication = application_1.PocketGatewayApplication;
const logger = require('./services/logger');
async function main(options = {}) {
    const app = new application_1.PocketGatewayApplication(options);
    await app.boot();
    await app.start();
    await app.loadPocket();
    logger.log('info', `Server is running at ${app.restServer.url}`, {
        requestID: '',
        relayType: '',
        typeID: '',
        serviceNode: '',
    });
    return app;
}
exports.main = main;
//# sourceMappingURL=index.js.map