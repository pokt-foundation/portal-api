export const Blockchains: {[key: string]: string} = {
    "mainnet"     : "0021",
    "ropsten"     : "0023",
    "rinkeby"     : "0022",
    "goerli"      : "0020",
    "kotti"       : "001F",
};

export class BlockchainHelper {
    public static getChainFromHost(host: string): string {
        const hostSplit = host.split(".");
        if (!Blockchains[hostSplit[0]]) {
            return Blockchains["mainnet"];
        }
        return Blockchains[hostSplit[0]];
    }

    // TODO: write helper function to make sure string is a valid chain
    // Check it in sequence and controller
}