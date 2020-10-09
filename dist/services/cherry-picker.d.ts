import { Node, Session } from '@pokt-network/pocket-js';
import { Redis } from 'ioredis';
import { Applications } from '../models';
export declare class CherryPicker {
    checkDebug: boolean;
    redis: Redis;
    constructor({ redis, checkDebug }: {
        redis: Redis;
        checkDebug: boolean;
    });
    cherryPickApplication(loadBalancerID: string, applications: Array<string>, blockchain: string, requestID: string): Promise<string>;
    cherryPickNode(application: Applications, pocketSession: Session, blockchain: string, requestID: string): Promise<Node>;
    fetchRawServiceLog(blockchain: string, id: string | undefined): Promise<string | null>;
    updateServiceQuality(blockchain: string, applicationID: string, serviceNode: string, elapsedTime: number, result: number): Promise<void>;
    _updateServiceQuality(blockchain: string, id: string, elapsedTime: number, result: number, ttl: number): Promise<void>;
    rankItems(sortedLogs: Array<ServiceLog>, maxFailuresPerPeriod: number): string[];
    createUnsortedLog(id: string, rawServiceLog: any): ServiceLog;
    sortLogs(array: ServiceLog[], requestID: string, relayType: string, typeID: string): ServiceLog[];
}
declare type ServiceLog = {
    id: string;
    attempts: number;
    successRate: number;
    averageSuccessLatency: number;
};
export {};
