import {Configuration, Node, Pocket} from '@pokt-network/pocket-js';
import {Redis} from 'ioredis';
var crypto = require('crypto');

const logger = require('../services/logger');

export class SyncChecker {
  redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async consensusFilter(nodes: Node[], syncCheck: string, blockchain: string, pocket: Pocket, pocketConfiguration: Configuration): Promise<Node[]> {
    let syncedNodes: Node[] = [];

    // Key is "blockchain - a hash of the nodes sorted by public key"
    const syncedNodesKey = blockchain + '-' + crypto.createHash('sha256').update(JSON.stringify(nodes.sort((a,b) => (a.publicKey > b.publicKey) ? 1 : ((b.publicKey > a.publicKey) ? -1 : 0)), (k, v) => k != 'publicKey' ? v : undefined)).digest('hex');
    const syncedNodesCache = await this.redis.get(syncedNodesKey);

    if (syncedNodesCache) {
      return JSON.parse(syncedNodesCache);
    }

    // Check lock key; if lock key exists, return full node set
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
      /*
      const relayResponse = await pocket.sendRelay(
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
    logger.log('info', 'SYNC CHECK: writing sync status ' + syncedNodesKey);
    await this.redis.set(
      syncedNodesKey,
      JSON.stringify(syncedNodes),
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
  sync: boolean;
}