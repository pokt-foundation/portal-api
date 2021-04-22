import {Configuration, HTTPMethod, Node, Pocket, PocketAAT, RelayResponse} from '@pokt-network/pocket-js';
import {Redis} from 'ioredis';
var crypto = require('crypto');

const logger = require('../services/logger');

export class SyncChecker {
  redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async consensusFilter(nodes: Node[], syncCheck: string, blockchain: string, pocket: Pocket, pocketAAT: PocketAAT, pocketConfiguration: Configuration): Promise<Node[]> {
    let syncedNodes: Node[] = [];
    let syncedNodesList: String[] = [];

    // Key is "blockchain - a hash of the all the nodes in this session, sorted by public key"
    // Value is an array of node public keys that have passed sync checks for this session in the past 5 minutes
    const syncedNodesKey = blockchain + '-' + crypto.createHash('sha256').update(JSON.stringify(nodes.sort((a,b) => (a.publicKey > b.publicKey) ? 1 : ((b.publicKey > a.publicKey) ? -1 : 0)), (k, v) => k != 'publicKey' ? v : undefined)).digest('hex');
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
      
      logger.log('info', 'SYNC CHECK: request ' + syncCheck, {requestID: '', relayType: '', typeID: '', serviceNode: node.publicKey});
      const relayResponse = await pocket.sendRelay(
        syncCheck,
        blockchain,
        pocketAAT,
        pocketConfiguration,
        undefined,
        'POST' as HTTPMethod,
        undefined
      );
  
      if (relayResponse instanceof RelayResponse) {
        const payload = JSON.parse(relayResponse.payload);
            
        // Create a NodeSyncLog for each node with current block
        const nodeSyncLog = {node: node, blockchain: blockchain, blockHeight: parseInt(payload.result, 16)} as NodeSyncLog;
        logger.log('info', 'SYNC CHECK RESULT: ' + JSON.stringify(nodeSyncLog), {requestID: '', relayType: '', typeID: '', serviceNode: node.publicKey});
      }
      else {
        logger.log('error', 'SYNC CHECK ERROR: ' + JSON.stringify(relayResponse), {requestID: '', relayType: '', typeID: '', serviceNode: node.publicKey});
      }

      // Sort NodeSyncLogs by blockHeight

      // Make sure at least 2 nodes agree on current highest block to prevent one node from being wildly off

      // Go through nodes and add all nodes that are current or within 1 block -- this allows for block processing times
      syncedNodes.push(node);
      syncedNodesList.push(node.publicKey);
    }
    logger.log('info', 'SYNC CHECK: writing sync status ' + syncedNodesKey);
    await this.redis.set(
      syncedNodesKey,
      JSON.stringify(syncedNodesList),
      'EX',
      300,
    );
    return syncedNodes;
  }
}

type NodeSyncLog = {
  node: Node;
  blockchain: string;
  blockHeight: Number;
  sync?: boolean;
}