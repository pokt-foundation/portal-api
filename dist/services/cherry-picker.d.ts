import { Node } from '@pokt-network/pocket-js';
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
    cherryPickNode(application: Applications, nodes: Node[], blockchain: string, requestID: string): Promise<Node>;
    fetchRawServiceLog(blockchain: string, id: string | undefined): Promise<string | null>;
    fetchRawFailureLog(blockchain: string, id: string | undefined): Promise<string | null>;
    fetchClientTypeLog(blockchain: string, id: string | undefined): Promise<string | null>;
    updateServiceQuality(blockchain: string, applicationID: string, serviceNode: string, elapsedTime: number, result: number): Promise<void>;
    _updateServiceQuality(blockchain: string, id: string, elapsedTime: number, result: number, ttl: number): Promise<void>;
    rankItems(blockchain: string, sortedLogs: Array<ServiceLog>, maxFailuresPerPeriod: number): Promise<string[]>;
    createUnsortedLog(id: string, blockchain: string, rawServiceLog: any): Promise<ServiceLog>;
    sortLogs(array: ServiceLog[], requestID: string, relayType: string, typeID: string): ServiceLog[];
}
declare type ServiceLog = {
    id: string;
    attempts: number;
    successRate: number;
    averageSuccessLatency: number;
    failure: boolean;
};
export {};
