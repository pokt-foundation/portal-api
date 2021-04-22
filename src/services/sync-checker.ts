import {HTTPMethod, Node, RelayResponse, Session} from '@pokt-network/pocket-js';
import {Redis} from 'ioredis';

const logger = require('../services/logger');

export class SyncChecker {
  redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async consensusFilter(nodes: Node[], syncCheck: string): Promise<Node[]> {
    let syncedNodes: Node[] = [];
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