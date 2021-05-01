import { BaseProfiler, ProfileResult } from '@pokt-network/pocket-js';
import { Pool as PGPool } from 'pg';
export declare class RelayProfiler extends BaseProfiler {
    data: {
        key: string;
        time_elapsed: number | undefined;
    }[];
    pgPool: PGPool;
    constructor(pgPool: PGPool);
    flushResults(requestID: string, blockchain: string, functionName: string, results: ProfileResult[]): Promise<void>;
}
