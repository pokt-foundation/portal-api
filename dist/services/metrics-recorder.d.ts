import { Redis } from 'ioredis';
import { Pool as PGPool } from "pg";
import { CherryPicker } from './cherry-picker';
export declare class MetricsRecorder {
    redis: Redis;
    pgPool: PGPool;
    cherryPicker: CherryPicker;
    processUID: string;
    constructor(redis: Redis, pgPool: PGPool, cherryPicker: CherryPicker, processUID: string);
    recordMetric({ appPubKey, blockchain, serviceNode, elapsedStart, result, bytes, method, }: {
        appPubKey: string;
        blockchain: string;
        serviceNode: string | undefined;
        elapsedStart: [number, number];
        result: number;
        bytes: number;
        method: string | undefined;
    }): Promise<void>;
}
