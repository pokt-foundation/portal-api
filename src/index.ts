import {PocketGatewayApplication} from './application';
import {ApplicationConfig} from '@loopback/core';

const logger = require('./services/logger');

export {PocketGatewayApplication};

export async function main(options: ApplicationConfig = {}) {
  const app = new PocketGatewayApplication(options);
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
