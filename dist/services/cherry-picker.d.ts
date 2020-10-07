import { Node, Session } from '@pokt-network/pocket-js';
import { Redis } from 'ioredis';
export declare class CherryPicker {
    checkDebug: boolean;
    redis: Redis;
    constructor({ redis, checkDebug }: {
        redis: Redis;
        checkDebug: boolean;
    });
    cherryPickApplication(applications: Array<string>, blockchain: string): Promise<string>;
    cherryPickNode(pocketSession: Session, blockchain: string): Promise<Node>;
    fetchRawServiceLog(blockchain: string, id: string | undefined): Promise<string | null>;
    updateServiceQuality(blockchain: string, applicationID: string, serviceNode: string, elapsedTime: number, result: number): Promise<void>;
    _updateServiceQuality(blockchain: string, id: string, elapsedTime: number, result: number): Promise<void>;
    rankItems(sortedLogs: Array<ServiceLog>, maxFailuresPerPeriod: number): string[];
    createUnsortedLog(id: string, rawServiceLog: any): ServiceLog;
    sortLogs(array: ServiceLog[]): ServiceLog[];
}
declare type ServiceLog = {
    id: string;
    attempts: number;
    successRate: number;
    averageSuccessLatency: number;
};
export {};
