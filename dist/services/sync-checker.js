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
            // logger.log('info', 'SYNC CHECK: ' + syncedNodes.length + ' nodes returned');
            return syncedNodes;
        }
        // Cache is stale, start a new cache fill
        // First check cache lock key; if lock key exists, return full node set
        const syncLock = await this.redis.get('lock-' + syncedNodesKey);
        if (syncLock) {
            return nodes;
        }
        else {
            // Set lock as this thread checks the sync with 60 second ttl.
            // If any major errors happen below, it will retry the sync check every 60 seconds.
            await this.redis.set('lock-' + syncedNodesKey, 'true', 'EX', 60);
        }
        const nodeSyncLogs = [];
        // Check sync of nodes with consensus
        for (const node of nodes) {
            // Pull the current block from each node using the blockchain's syncCheck as the relay
            const relayResponse = await pocket.sendRelay(syncCheck, blockchain, pocketAAT, pocketConfiguration, undefined, 'POST', undefined, node);
            if (relayResponse instanceof pocket_js_1.RelayResponse) {
                const payload = JSON.parse(relayResponse.payload);
                // Create a NodeSyncLog for each node with current block
                const nodeSyncLog = { node: node, blockchain: blockchain, blockHeight: parseInt(payload.result, 16) };
                nodeSyncLogs.push(nodeSyncLog);
                // logger.log('info', 'SYNC CHECK RESULT: ' + JSON.stringify(nodeSyncLog), {requestID: '', relayType: '', typeID: '', serviceNode: node.publicKey});
            }
            else {
                logger.log('error', 'SYNC CHECK ERROR: ' + JSON.stringify(relayResponse), { requestID: '', relayType: '', typeID: '', serviceNode: node.publicKey, error: '', elapsedTime: '' });
            }
        }
        // This should never happen
        if (nodeSyncLogs.length <= 2) {
            logger.log('error', 'SYNC CHECK ERROR: fewer than 3 nodes returned sync', { requestID: '', relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: '' });
            return nodes;
        }
        // Sort NodeSyncLogs by blockHeight
        nodeSyncLogs.sort((a, b) => (a.blockHeight > b.blockHeight) ? 1 : ((b.blockHeight > a.blockHeight) ? -1 : 0));
        // If top node is still 0, or not a number, return all nodes due to check failure
        if (nodeSyncLogs[0].blockHeight === 0 ||
            typeof nodeSyncLogs[0].blockHeight !== 'number' ||
            (nodeSyncLogs[0].blockHeight % 1) !== 0) {
            logger.log('error', 'SYNC CHECK ERROR: top synced node result is invalid ' + nodeSyncLogs[0].blockHeight, { requestID: '', relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: '' });
            return nodes;
        }
        // Make sure at least 2 nodes agree on current highest block to prevent one node from being wildly off
        if (nodeSyncLogs[0].blockHeight > (nodeSyncLogs[1].blockHeight + 1)) {
            logger.log('error', 'SYNC CHECK ERROR: two highest nodes could not agree on sync', { requestID: '', relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: '' });
            return nodes;
        }
        const currentBlockHeight = nodeSyncLogs[0].blockHeight;
        // Go through nodes and add all nodes that are current or within 1 block -- this allows for block processing times
        for (const nodeSyncLog of nodeSyncLogs) {
            logger.log('info', 'SYNC CHECK RESULT: ' + nodeSyncLog.node.address + ' height: ' + nodeSyncLog.blockHeight, { requestID: '', relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: '' });
            if ((nodeSyncLog.blockHeight + 1) >= currentBlockHeight) {
                syncedNodes.push(nodeSyncLog.node);
                syncedNodesList.push(nodeSyncLog.node.publicKey);
            }
        }
        logger.log('info', 'SYNC CHECK COMPLETE: ' + syncedNodes.length + ' nodes in sync', { requestID: '', relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: '' });
        await this.redis.set(syncedNodesKey, JSON.stringify(syncedNodesList), 'EX', 300);
        // If one or more nodes of this session are not in sync, fire a consensus relay with the same check.
        // This will penalize the out-of-sync nodes and cause them to get slashed for reporting incorrect data.
        // Fire this off synchronously so we don't have to wait for the results.
        if (syncedNodes.length < 5) {
            const consensusResponse = await pocket.sendRelay(syncCheck, blockchain, pocketAAT, this.updateConfigurationConsensus(pocketConfiguration), undefined, 'POST', undefined);
            logger.log('info', 'SYNC CHECK CHALLENGE: ' + JSON.stringify(consensusResponse), { requestID: '', relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: '' });
        }
        return syncedNodes;
    }
    updateConfigurationConsensus(pocketConfiguration) {
        return new pocket_js_1.Configuration(pocketConfiguration.maxDispatchers, pocketConfiguration.maxSessions, 5, pocketConfiguration.requestTimeOut, pocketConfiguration.acceptDisputedResponses, pocketConfiguration.sessionBlockFrequency, pocketConfiguration.blockTime, pocketConfiguration.maxSessionRefreshRetries, pocketConfiguration.validateRelayResponses, pocketConfiguration.rejectSelfSignedCertificates);
    }
}
exports.SyncChecker = SyncChecker;
//# sourceMappingURL=sync-checker.js.map