import {BootMixin} from '@loopback/boot';
import {ApplicationConfig} from '@loopback/core';
import {RepositoryMixin} from '@loopback/repository';
import {
  RestApplication,
  HttpErrors
} from '@loopback/rest';
import {ServiceMixin} from '@loopback/service-proxy';
import {GatewaySequence} from './sequence';
import {Account} from '@pokt-network/pocket-js/lib/src/keybase/models/account'

import path from 'path';
import {
  Pocket, 
  Configuration, 
  HttpRpcProvider
} from '@pokt-network/pocket-js';
var Redis = require('ioredis');

require('log-timestamp');

export class PocketGatewayApplication extends BootMixin(
  ServiceMixin(RepositoryMixin(RestApplication)),
) {
  constructor(options: ApplicationConfig = {}) {
    super(options);
    this.sequence(GatewaySequence);
    this.static('/', path.join(__dirname, '../public'));

    this.projectRoot = __dirname;
    this.bootOptions = {
      controllers: {
        dirs: ['controllers'],
        extensions: ['.controller.js'],
        nested: true,
      },
    };
  }

  async loadPocket(): Promise<void> {
    // Requirements; for Production these are stored in AWS Secrets Manager in the
    // corresponding region of the container.
    //
    // For Dev, you need to pass them in via command line before npm start or 
    // via docker run
    //
    // TODO: change to https when infra is finished
    const dispatchURL: string = process.env.DISPATCH_URL || "";
    const clientPrivateKey: string = process.env.CLIENT_PRIVATE_KEY || "";
    const clientPassphrase: string = process.env.CLIENT_PASSPHRASE || "";

    if (!dispatchURL) {
      throw new HttpErrors.InternalServerError("DISPATCH_URL required in ENV");
    }
    if (!clientPrivateKey) {
      throw new HttpErrors.InternalServerError("CLIENT_PRIVATE_KEY required in ENV");
    }
    if (!clientPassphrase) {
      throw new HttpErrors.InternalServerError("CLIENT_PASSPHRASE required in ENV");
    }

    // Create the Pocket instance
    const dispatchers = new URL(dispatchURL);
    const configuration = new Configuration(5, 1000, 5, 40000, true);
    const rpcProvider = new HttpRpcProvider(dispatchers)
    const pocket = new Pocket([dispatchers], rpcProvider, configuration);
 
    // Bind to application context for shared re-use
    this.bind("pocketInstance").to(pocket);

    // Unlock primary client account for relay signing
    try {
      const importAccount = await pocket.keybase.importAccount(Buffer.from(clientPrivateKey, 'hex'), clientPassphrase);
      if (importAccount instanceof Account) {
        await pocket.keybase.unlockAccount(importAccount.addressHex, clientPassphrase, 0);
      }
    }
    catch(e) {
      console.log(e);
      throw new HttpErrors.InternalServerError("Unable to import or unlock base client account");
    }

    // Load Redis for cache
    const redisEndpoint: string = process.env.REDIS_ENDPOINT || "";
    const redisPort: string = process.env.REDIS_PORT || "";

    if (!redisEndpoint) {
      throw new HttpErrors.InternalServerError("REDIS_ENDPOINT required in ENV");
    }
    if (!redisPort) {
      throw new HttpErrors.InternalServerError("REDIS_PORT required in ENV");
    }
    const redis = new Redis(redisPort, redisEndpoint);
    this.bind("redisInstance").to(redis);
  }
}
