import { Configuration, Node, Pocket, PocketAAT } from '@pokt-network/pocket-js';
import { MetricsRecorder } from '../services/metrics-recorder';
import { Redis } from 'ioredis';
export declare class SyncChecker {
    redis: Redis;
    metricsRecorder: MetricsRecorder;
    constructor(redis: Redis, metricsRecorder: MetricsRecorder);
    consensusFilter(nodes: Node[], requestID: string, syncCheck: string, syncAllowance: number | undefined, blockchain: string, applicationID: string, applicationPublicKey: string, pocket: Pocket, pocketAAT: PocketAAT, pocketConfiguration: Configuration): Promise<Node[]>;
    getNodeSyncLogs(nodes: Node[], requestID: string, syncCheck: string, blockchain: string, applicationID: string, applicationPublicKey: string, pocket: Pocket, pocketAAT: PocketAAT, pocketConfiguration: Configuration): Promise<NodeSyncLog[]>;
    getNodeSyncLog(node: Node, requestID: string, syncCheck: string, blockchain: string, applicationID: string, applicationPublicKey: string, pocket: Pocket, pocketAAT: PocketAAT, pocketConfiguration: Configuration): Promise<NodeSyncLog>;
    updateConfigurationConsensus(pocketConfiguration: Configuration): Configuration;
    updateConfigurationTimeout(pocketConfiguration: Configuration): Configuration;
}
declare type NodeSyncLog = {
    node: Node;
    blockchain: string;
    blockHeight: number;
};
export {};
