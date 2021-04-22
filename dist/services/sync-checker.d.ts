import { Configuration, Node, Pocket, PocketAAT } from '@pokt-network/pocket-js';
import { Redis } from 'ioredis';
export declare class SyncChecker {
    redis: Redis;
    constructor(redis: Redis);
    consensusFilter(nodes: Node[], syncCheck: string, blockchain: string, pocket: Pocket, pocketAAT: PocketAAT, pocketConfiguration: Configuration): Promise<Node[]>;
}
