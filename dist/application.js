"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const boot_1 = require("@loopback/boot");
const rest_explorer_1 = require("@loopback/rest-explorer");
const repository_1 = require("@loopback/repository");
const rest_1 = require("@loopback/rest");
const service_proxy_1 = require("@loopback/service-proxy");
const path_1 = tslib_1.__importDefault(require("path"));
const sequence_1 = require("./sequence");
const pocket_js_1 = require("@pokt-network/pocket-js");
require('log-timestamp');
class PocketGatewayApplication extends boot_1.BootMixin(service_proxy_1.ServiceMixin(repository_1.RepositoryMixin(rest_1.RestApplication))) {
    constructor(options = {}) {
        super(options);
        // Set up the custom sequence
        this.sequence(sequence_1.GatewaySequence);
        // Set up default home page
        this.static('/', path_1.default.join(__dirname, '../public'));
        // Customize @loopback/rest-explorer configuration here
        this.configure(rest_explorer_1.RestExplorerBindings.COMPONENT).to({
            path: '/explorer',
        });
        this.component(rest_explorer_1.RestExplorerComponent);
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
    async loadPocket() {
        // Create the Pocket instance
        const dispatchers = new URL("http://localhost:8081");
        const configuration = new pocket_js_1.Configuration(5, 1000, 5, 40000, true);
        const rpcProvider = new pocket_js_1.HttpRpcProvider(dispatchers);
        const pocket = new pocket_js_1.Pocket([dispatchers], rpcProvider, configuration);
        // Unlock primary client account for relay signing
        // TODO: move this junk data into ENV or some other way of secure deployment
        const clientPrivKey = 'd561ca942e974c541d4999fe2c647f238c22eb42441a472989d2a18a5437a9cfc4553f77697e2dc51ae2b2a7460821dcde8ca876a1b602d13501d9d37584ddfc';
        const importAcct = await pocket.keybase.importAccount(Buffer.from(clientPrivKey, 'hex'), 'pocket');
        const unlockAcct = await pocket.keybase.unlockAccount('d0092305fa8ebf9a97a61d007b878a7840f51900', 'pocket', 0);
        this.bind("pocketInstance").to(pocket);
    }
}
exports.PocketGatewayApplication = PocketGatewayApplication;
//# sourceMappingURL=application.js.map