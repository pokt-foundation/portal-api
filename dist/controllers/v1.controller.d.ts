import { FilterExcludingWhere } from '@loopback/repository';
import { Applications, LoadBalancers } from '../models';
import { ApplicationsRepository, BlockchainsRepository, LoadBalancersRepository } from '../repositories';
import { Pocket, Configuration, HTTPMethod } from '@pokt-network/pocket-js';
import { Redis } from 'ioredis';
import { Pool as PGPool } from 'pg';
import { CherryPicker } from '../services/cherry-picker';
import { MetricsRecorder } from '../services/metrics-recorder';
import { PocketRelayer } from '../services/pocket-relayer';
import { SyncChecker } from '../services/sync-checker';
export declare class V1Controller {
    private secretKey;
    private host;
    private origin;
    private userAgent;
    private contentType;
    private httpMethod;
    private relayPath;
    private relayRetries;
    private pocket;
    private pocketConfiguration;
    private redis;
    private pgPool;
    private databaseEncryptionKey;
    private processUID;
    private fallbackURL;
    private requestID;
    applicationsRepository: ApplicationsRepository;
    private blockchainsRepository;
    private loadBalancersRepository;
    cherryPicker: CherryPicker;
    metricsRecorder: MetricsRecorder;
    pocketRelayer: PocketRelayer;
    syncChecker: SyncChecker;
    constructor(secretKey: string, host: string, origin: string, userAgent: string, contentType: string, httpMethod: HTTPMethod, relayPath: string, relayRetries: number, pocket: Pocket, pocketConfiguration: Configuration, redis: Redis, pgPool: PGPool, databaseEncryptionKey: string, processUID: string, fallbackURL: string, requestID: string, applicationsRepository: ApplicationsRepository, blockchainsRepository: BlockchainsRepository, loadBalancersRepository: LoadBalancersRepository);
    /**
     * Load Balancer Relay
     *
     * Send a Pocket Relay using a Gateway Load Balancer ID
     *
     * @param id Load Balancer ID
     */
    loadBalancerRelay(id: string, rawData: object, filter?: FilterExcludingWhere<Applications>): Promise<string | Error>;
    /**
     * Application Relay
     *
     * Send a Pocket Relay using a specific Application's ID
     *
     * @param id Application ID
     */
    applicationRelay(id: string, rawData: object, filter?: FilterExcludingWhere<Applications>): Promise<string | Error>;
    fetchLoadBalancer(id: string, filter: FilterExcludingWhere | undefined): Promise<LoadBalancers | undefined>;
    fetchApplication(id: string, filter: FilterExcludingWhere | undefined): Promise<Applications | undefined>;
    fetchLoadBalancerApplication(id: string, applicationIDs: string[], blockchain: string, filter: FilterExcludingWhere | undefined): Promise<Applications | undefined>;
    checkDebug(): boolean;
}
