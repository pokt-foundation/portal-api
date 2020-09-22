import { Node, Session } from '@pokt-network/pocket-js';
import { Redis } from 'ioredis';
export declare class CherryPicker {
    checkDebug: boolean;
    redis: Redis;
    constructor({ redis, checkDebug }: {
        redis: Redis;
        checkDebug: boolean;
    });
    fetchServiceLog(blockchain: string, serviceNode: string): Promise<string | null>;
    updateServiceNodeQuality(blockchain: string, serviceNode: string, elapsedTime: number, result: number): Promise<void>;
    cherryPickNode(pocketSession: Session, blockchain: string): Promise<Node>;
}
