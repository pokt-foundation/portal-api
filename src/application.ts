import {BootMixin} from '@loopback/boot';
import {ApplicationConfig} from '@loopback/core';
import {
  RestExplorerBindings,
  RestExplorerComponent,
} from '@loopback/rest-explorer';
import {RepositoryMixin} from '@loopback/repository';
import {RestApplication} from '@loopback/rest';
import {ServiceMixin} from '@loopback/service-proxy';
import path from 'path';
import {GatewaySequence} from './sequence';

import {
  Pocket, 
  Configuration, 
  HttpRpcProvider
} from '@pokt-network/pocket-js';

require('log-timestamp');

export class PocketGatewayApplication extends BootMixin(
  ServiceMixin(RepositoryMixin(RestApplication)),
) {
  constructor(options: ApplicationConfig = {}) {
    super(options);

    // Set up the custom sequence
    this.sequence(GatewaySequence);

    // Set up default home page
    this.static('/', path.join(__dirname, '../public'));

    // Customize @loopback/rest-explorer configuration here
    this.configure(RestExplorerBindings.COMPONENT).to({
      path: '/explorer',
    });
    this.component(RestExplorerComponent);

    this.projectRoot = __dirname;
    // Customize @loopback/boot Booter Conventions here
    this.bootOptions = {
      controllers: {
        // Customize ControllerBooter Conventions here
        dirs: ['controllers'],
        extensions: ['.controller.js'],
        nested: true,
      },
    };
  }

  async loadPocket(): Promise<void> {
    // Create the Pocket instance
    const dispatchers = new URL("http://localhost:8081");
    const configuration = new Configuration(5, 1000, 5, 40000, true);
    const rpcProvider = new HttpRpcProvider(dispatchers)
    const pocket = new Pocket([dispatchers], rpcProvider, configuration);
 
    // Unlock primary client account for relay signing
    // TODO: move this junk data into ENV or some other way of secure deployment
    const clientPrivKey = 'd561ca942e974c541d4999fe2c647f238c22eb42441a472989d2a18a5437a9cfc4553f77697e2dc51ae2b2a7460821dcde8ca876a1b602d13501d9d37584ddfc'
    const importAcct = await pocket.keybase.importAccount(Buffer.from(clientPrivKey, 'hex'), 'pocket');
    const unlockAcct =  await pocket.keybase.unlockAccount('d0092305fa8ebf9a97a61d007b878a7840f51900', 'pocket', 0);
    
    this.bind("pocketInstance").to(pocket);
  }
}
