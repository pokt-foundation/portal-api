export const Blockchains: {[key: string]: string} = {
    mainnet     : "0021",
    ropsten     : "0023",
    rinkeby     : "0022",
    goerli      : "0020",
    kotti       : "001F",
};

export class BlockchainHelper {
    public static getChainFromHost(host: string): string {
        const hostSplit = host.split(".");
        if (!Blockchains[hostSplit[0]]) {
            throw new Error("Invalid blockchain request: " + hostSplit[0])
        }
        return Blockchains[hostSplit[0]];
    }
}