"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// TODO: move to DB
exports.Blockchains = {
    "mainnet": "0021",
    "ropsten": "0023",
    "rinkeby": "0022",
    "goerli": "0020",
    "kotti": "001F",
};
class BlockchainHelper {
    static getChainFromHost(host) {
        const hostSplit = host.split(".");
        if (!exports.Blockchains[hostSplit[0]]) {
            return exports.Blockchains["mainnet"];
        }
        return exports.Blockchains[hostSplit[0]];
    }
}
exports.BlockchainHelper = BlockchainHelper;
//# sourceMappingURL=blockchain.js.map