import {PocketGatewayApplication} from '../..';
import {
  createRestAppClient,
  givenHttpServerConfig,
  Client,
} from '@loopback/testlab';

export async function setupApplication(): Promise<AppWithClient> {
  const restConfig = givenHttpServerConfig({
    // Customize the server configuration here.
    // Empty values (undefined, '') will be ignored by the helper.
    //
    // host: process.env.HOST,
    // port: +process.env.PORT,
  });

  const app = new PocketGatewayApplication({
    rest: restConfig,
    env: {load: false, values: {}}
  });

  await app.boot();
  await app.start();
  await app.loadPocket();

  const client = createRestAppClient(app);

  return {app, client};
}

export interface AppWithClient {
  app: PocketGatewayApplication;
  client: Client;
}
