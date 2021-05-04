import { Configuration, Node, Pocket, PocketAAT } from '@pokt-network/pocket-js';
import { MetricsRecorder } from '../services/metrics-recorder';
import { Redis } from 'ioredis';
export declare class SyncChecker {
    redis: Redis;
    metricsRecorder: MetricsRecorder;
    constructor(redis: Redis, metricsRecorder: MetricsRecorder);
    consensusFilter(nodes: Node[], syncCheck: string, syncAllowance: number | undefined, blockchain: string, applicationID: string, applicationPublicKey: string, pocket: Pocket, pocketAAT: PocketAAT, pocketConfiguration: Configuration): Promise<Node[]>;
    updateConfigurationConsensus(pocketConfiguration: Configuration): Configuration;
    updateConfigurationTimeout(pocketConfiguration: Configuration): Configuration;
}
