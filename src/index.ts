import {PocketGatewayApplication} from './application';
import {ApplicationConfig} from '@loopback/core';

export {PocketGatewayApplication};

export async function main(options: ApplicationConfig = {}) {
  const app = new PocketGatewayApplication(options);
  await app.boot();
  await app.start();
  await app.loadPocket();

  console.log(`Server is running at ${app.restServer.url}`);
  return app;
}
