import { Redis } from 'ioredis';
import { Pool as PGPool } from 'pg';
import { CherryPicker } from './cherry-picker';
export declare class MetricsRecorder {
    redis: Redis;
    pgPool: PGPool;
    cherryPicker: CherryPicker;
    processUID: string;
    constructor({ redis, pgPool, cherryPicker, processUID, }: {
        redis: Redis;
        pgPool: PGPool;
        cherryPicker: CherryPicker;
        processUID: string;
    });
    recordMetric({ appPubKey, blockchain, serviceNode, relayStart, result, bytes, method, }: {
        appPubKey: string;
        blockchain: string;
        serviceNode: string | undefined;
        relayStart: [number, number];
        result: number;
        bytes: number;
        method: string | undefined;
    }): Promise<void>;
}
