"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pocket_js_1 = require("@pokt-network/pocket-js");
var crypto = require('crypto');
const logger = require('../services/logger');
class SyncChecker {
    constructor(redis, metricsRecorder) {
        this.redis = redis;
        this.metricsRecorder = metricsRecorder;
    }
    async consensusFilter(nodes, requestID, syncCheck, syncAllowance = 1, blockchain, applicationID, applicationPublicKey, pocket, pocketAAT, pocketConfiguration) {
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
            logger.log('info', 'SYNC CHECK CACHE: ' + syncedNodes.length + ' nodes returned');
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
        // Fires all 5 sync checks synchronously then assembles the results
        const nodeSyncLogs = await this.getNodeSyncLogs(nodes, requestID, syncCheck, blockchain, applicationID, applicationPublicKey, pocket, pocketAAT, pocketConfiguration);
        // This should never happen
        if (nodeSyncLogs.length <= 2) {
            logger.log('error', 'SYNC CHECK ERROR: fewer than 3 nodes returned sync', { requestID: requestID, relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: '' });
            return nodes;
        }
        // Sort NodeSyncLogs by blockHeight
        nodeSyncLogs.sort((a, b) => b.blockHeight - a.blockHeight);
        // If top node is still 0, or not a number, return all nodes due to check failure
        if (nodeSyncLogs[0].blockHeight === 0 ||
            typeof nodeSyncLogs[0].blockHeight !== 'number' ||
            (nodeSyncLogs[0].blockHeight % 1) !== 0) {
            logger.log('error', 'SYNC CHECK ERROR: top synced node result is invalid ' + nodeSyncLogs[0].blockHeight, { requestID: requestID, relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: '' });
            return nodes;
        }
        // Make sure at least 2 nodes agree on current highest block to prevent one node from being wildly off
        if (nodeSyncLogs[0].blockHeight > (nodeSyncLogs[1].blockHeight + syncAllowance)) {
            logger.log('error', 'SYNC CHECK ERROR: two highest nodes could not agree on sync', { requestID: requestID, relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: '' });
            return nodes;
        }
        const currentBlockHeight = nodeSyncLogs[0].blockHeight;
        // Go through nodes and add all nodes that are current or within 1 block -- this allows for block processing times
        for (const nodeSyncLog of nodeSyncLogs) {
            let relayStart = process.hrtime();
            if ((nodeSyncLog.blockHeight + syncAllowance) >= currentBlockHeight) {
                logger.log('info', 'SYNC CHECK IN-SYNC: ' + nodeSyncLog.node.publicKey + ' height: ' + nodeSyncLog.blockHeight, { requestID: requestID, relayType: '', typeID: '', serviceNode: nodeSyncLog.node.publicKey, error: '', elapsedTime: '' });
                // In-sync: add to nodes list
                syncedNodes.push(nodeSyncLog.node);
                syncedNodesList.push(nodeSyncLog.node.publicKey);
            }
            else {
                logger.log('info', 'SYNC CHECK BEHIND: ' + nodeSyncLog.node.publicKey + ' height: ' + nodeSyncLog.blockHeight, { requestID: requestID, relayType: '', typeID: '', serviceNode: nodeSyncLog.node.publicKey, error: '', elapsedTime: '' });
                await this.metricsRecorder.recordMetric({
                    requestID: requestID,
                    applicationID: applicationID,
                    appPubKey: applicationPublicKey,
                    blockchain,
                    serviceNode: nodeSyncLog.node.publicKey,
                    relayStart,
                    result: 500,
                    bytes: Buffer.byteLength('OUT OF SYNC', 'utf8'),
                    delivered: false,
                    fallback: false,
                    method: 'synccheck',
                    error: 'OUT OF SYNC',
                });
            }
        }
        logger.log('info', 'SYNC CHECK COMPLETE: ' + syncedNodes.length + ' nodes in sync', { requestID: requestID, relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: '' });
        await this.redis.set(syncedNodesKey, JSON.stringify(syncedNodesList), 'EX', 300);
        // If one or more nodes of this session are not in sync, fire a consensus relay with the same check.
        // This will penalize the out-of-sync nodes and cause them to get slashed for reporting incorrect data.
        if (syncedNodes.length < 5) {
            const consensusResponse = await pocket.sendRelay(syncCheck, blockchain, pocketAAT, this.updateConfigurationConsensus(pocketConfiguration), undefined, 'POST', undefined, undefined, true, 'synccheck');
            logger.log('info', 'SYNC CHECK CHALLENGE: ' + JSON.stringify(consensusResponse), { requestID: requestID, relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: '' });
        }
        return syncedNodes;
    }
    async getNodeSyncLogs(nodes, requestID, syncCheck, blockchain, applicationID, applicationPublicKey, pocket, pocketAAT, pocketConfiguration) {
        const nodeSyncLogs = [];
        const promiseStack = [];
        // Set to junk values first so that the Promise stack can fill them later
        let rawNodeSyncLogs = [0, 0, 0, 0, 0];
        for (const node of nodes) {
            promiseStack.push(this.getNodeSyncLog(node, requestID, syncCheck, blockchain, applicationID, applicationPublicKey, pocket, pocketAAT, pocketConfiguration));
        }
        [rawNodeSyncLogs[0], rawNodeSyncLogs[1], rawNodeSyncLogs[2], rawNodeSyncLogs[3], rawNodeSyncLogs[4]] = await Promise.all(promiseStack);
        for (const rawNodeSyncLog of rawNodeSyncLogs) {
            if (typeof rawNodeSyncLog === 'object' &&
                rawNodeSyncLog.blockHeight > 0) {
                nodeSyncLogs.push(rawNodeSyncLog);
            }
        }
        return nodeSyncLogs;
    }
    async getNodeSyncLog(node, requestID, syncCheck, blockchain, applicationID, applicationPublicKey, pocket, pocketAAT, pocketConfiguration) {
        logger.log('info', 'SYNC CHECK START', { requestID: requestID, relayType: '', typeID: '', serviceNode: node.publicKey, error: '', elapsedTime: '' });
        // Pull the current block from each node using the blockchain's syncCheck as the relay
        let relayStart = process.hrtime();
        const relayResponse = await pocket.sendRelay(syncCheck, blockchain, pocketAAT, this.updateConfigurationTimeout(pocketConfiguration), undefined, 'POST', undefined, node, false, 'synccheck');
        if (relayResponse instanceof pocket_js_1.RelayResponse) {
            const payload = JSON.parse(relayResponse.payload);
            // Create a NodeSyncLog for each node with current block
            const nodeSyncLog = { node: node, blockchain: blockchain, blockHeight: parseInt(payload.result, 16) };
            logger.log('info', 'SYNC CHECK RESULT: ' + JSON.stringify(nodeSyncLog), { requestID: requestID, relayType: '', typeID: '', serviceNode: node.publicKey, error: '', elapsedTime: '' });
            // Success
            return nodeSyncLog;
        }
        else if (relayResponse instanceof Error) {
            logger.log('error', 'SYNC CHECK ERROR: ' + JSON.stringify(relayResponse), { requestID: requestID, relayType: '', typeID: '', serviceNode: node.publicKey, error: '', elapsedTime: '' });
            let error = relayResponse.message;
            if (typeof relayResponse.message === 'object') {
                error = JSON.stringify(relayResponse.message);
            }
            if (error !== 'Provided Node is not part of the current session for this application, check your PocketAAT') {
                await this.metricsRecorder.recordMetric({
                    requestID: requestID,
                    applicationID: applicationID,
                    appPubKey: applicationPublicKey,
                    blockchain,
                    serviceNode: node.publicKey,
                    relayStart,
                    result: 500,
                    bytes: Buffer.byteLength(relayResponse.message, 'utf8'),
                    delivered: false,
                    fallback: false,
                    method: 'synccheck',
                    error,
                });
            }
        }
        else {
            logger.log('error', 'SYNC CHECK ERROR UNHANDLED: ' + JSON.stringify(relayResponse), { requestID: requestID, relayType: '', typeID: '', serviceNode: node.publicKey, error: '', elapsedTime: '' });
        }
        // Failed
        const nodeSyncLog = { node: node, blockchain: blockchain, blockHeight: 0 };
        return nodeSyncLog;
    }
    updateConfigurationConsensus(pocketConfiguration) {
        return new pocket_js_1.Configuration(pocketConfiguration.maxDispatchers, pocketConfiguration.maxSessions, 5, 2000, false, pocketConfiguration.sessionBlockFrequency, pocketConfiguration.blockTime, pocketConfiguration.maxSessionRefreshRetries, pocketConfiguration.validateRelayResponses, pocketConfiguration.rejectSelfSignedCertificates);
    }
    updateConfigurationTimeout(pocketConfiguration) {
        return new pocket_js_1.Configuration(pocketConfiguration.maxDispatchers, pocketConfiguration.maxSessions, pocketConfiguration.consensusNodeCount, 4000, pocketConfiguration.acceptDisputedResponses, pocketConfiguration.sessionBlockFrequency, pocketConfiguration.blockTime, pocketConfiguration.maxSessionRefreshRetries, pocketConfiguration.validateRelayResponses, pocketConfiguration.rejectSelfSignedCertificates);
    }
}
exports.SyncChecker = SyncChecker;
//# sourceMappingURL=sync-checker.js.map