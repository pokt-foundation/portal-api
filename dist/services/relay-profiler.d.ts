import { BaseProfiler, ProfileResult } from '@pokt-network/pocket-js';
export declare class RelayProfiler extends BaseProfiler {
    data: {
        key: string;
        time_elapsed: number | undefined;
    }[];
    flushResults(functionName: string, results: ProfileResult[]): void;
}
