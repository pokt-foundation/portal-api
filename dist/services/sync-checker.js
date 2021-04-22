"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pocket_js_1 = require("@pokt-network/pocket-js");
var crypto = require('crypto');
const logger = require('../services/logger');
class SyncChecker {
    constructor(redis) {
        this.redis = redis;
    }
    async consensusFilter(nodes, syncCheck, blockchain, pocket, pocketAAT, pocketConfiguration) {
        let syncedNodes = [];
        let syncedNodesList = [];
        // Key is "blockchain - a hash of the all the nodes in this session, sorted by public key"
        // Value is an array of node public keys that have passed sync checks for this session in the past 5 minutes
        const syncedNodesKey = blockchain + '-' + crypto.createHash('sha256').update(JSON.stringify(nodes.sort((a, b) => (a.publicKey > b.publicKey) ? 1 : ((b.publicKey > a.publicKey) ? -1 : 0)), (k, v) => k != 'publicKey' ? v : undefined)).digest('hex');
        const syncedNodesCached = await this.redis.get(syncedNodesKey);
        if (syncedNodesCached) {
            syncedNodesList = JSON.parse(syncedNodesCached);
            for (const node of nodes) {
                if (syncedNodesList.includes(node.publicKey)) {
                    syncedNodes.push(node);
                }
            }
            logger.log('info', 'SYNC CHECK: ' + syncedNodes.length + ' nodes returned');
            return syncedNodes;
        }
        // Cache is stale, start a new cache fill
        // First check cache lock key; if lock key exists, return full node set
        const syncLock = await this.redis.get('lock-' + syncedNodesKey);
        if (syncLock) {
            return nodes;
        }
        else {
            // Set lock as this thread checks the sync with 10 second ttl
            await this.redis.set('lock-' + syncedNodesKey, 'true', 'EX', 10);
        }
        // Check sync of nodes with consensus
        for (const node of nodes) {
            // Pull the current block from each node using the blockchain's syncCheck as the relay
            logger.log('info', 'SYNC CHECK: request ' + syncCheck, { requestID: '', relayType: '', typeID: '', serviceNode: node.publicKey });
            const relayResponse = await pocket.sendRelay(syncCheck, blockchain, pocketAAT, pocketConfiguration, undefined, 'POST', undefined);
            if (relayResponse instanceof pocket_js_1.RelayResponse) {
                logger.log('info', 'SYNC CHECK: payload ' + relayResponse.payload, { requestID: '', relayType: '', typeID: '', serviceNode: node.publicKey });
            }
            // Create a NodeSyncLog for each node with current block
            const nodeSyncLog = { node: node, blockchain: blockchain, blockHeight: 1 };
            // Sort NodeSyncLogs by blockHeight
            // Make sure at least 2 nodes agree on current highest block to prevent one node from being wildly off
            // Go through nodes and add all nodes that are current or within 1 block -- this allows for block processing times
            syncedNodes.push(node);
            syncedNodesList.push(node.publicKey);
        }
        logger.log('info', 'SYNC CHECK: writing sync status ' + syncedNodesKey);
        await this.redis.set(syncedNodesKey, JSON.stringify(syncedNodesList), 'EX', 300);
        return syncedNodes;
    }
}
exports.SyncChecker = SyncChecker;
//# sourceMappingURL=sync-checker.js.map