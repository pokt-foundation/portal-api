"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger = require('../services/logger');
class SyncChecker {
    constructor(redis) {
        this.redis = redis;
    }
    async consensusFilter(nodes, syncCheck) {
        let syncedNodes = [];
        for (const node of nodes) {
            /*
            const relayResponse = await this.pocket.sendRelay(
              '{"method":"web3_clientVersion","id":1,"jsonrpc":"2.0"}',
              blockchain,
              pocketAAT,
              this.pocketConfiguration,
              undefined,
              'POST' as HTTPMethod,
              undefined
            );
        
            if (relayResponse instanceof RelayResponse) {
              logger.log('info', 'CLIENT CHECK ' + relayResponse.payload, {requestID: requestID, relayType: '', typeID: '', serviceNode: node.publicKey});
              await this.redis.set(
                blockchain + '-' + node.publicKey + '-clientType',
                relayResponse.payload,
                'EX',
                (60 * 60 * 24),
              );
            }
            */
            syncedNodes.push(node);
        }
        logger.log('info', 'SYNC CHECK: ' + syncCheck + ' - results: ' + syncedNodes.length + ' nodes in consensus sync');
        return syncedNodes;
    }
}
exports.SyncChecker = SyncChecker;
//# sourceMappingURL=sync-checker.js.map