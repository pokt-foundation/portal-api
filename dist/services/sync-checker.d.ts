import { Node } from '@pokt-network/pocket-js';
import { Redis } from 'ioredis';
export declare class SyncChecker {
    redis: Redis;
    constructor(redis: Redis);
    consensusFilter(nodes: Node[], syncCheck: string): Promise<Node[]>;
}
