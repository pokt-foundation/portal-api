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
    recordMetric({ requestID, applicationID, appPubKey, blockchain, serviceNode, relayStart, result, bytes, delivered, fallback, method, error, }: {
        requestID: string;
        applicationID: string;
        appPubKey: string;
        blockchain: string;
        serviceNode: string | undefined;
        relayStart: [number, number];
        result: number;
        bytes: number;
        delivered: boolean;
        fallback: boolean;
        method: string | undefined;
        error: string | undefined;
    }): Promise<void>;
}
