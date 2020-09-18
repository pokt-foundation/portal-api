import { FilterExcludingWhere } from "@loopback/repository";
import { Applications } from "../models";
import { ApplicationsRepository, BlockchainsRepository, LoadBalancersRepository } from "../repositories";
import { PocketRelayer } from "../services/pocket-relayer";
import { Pocket, Configuration } from "@pokt-network/pocket-js";
import { Redis } from "ioredis";
import { Pool as PGPool } from "pg";
import { CherryPicker } from '../services/cherry-picker';
import { MetricsRecorder } from '../services/metrics-recorder';
export declare class V1Controller {
    private secretKey;
    private host;
    private origin;
    private userAgent;
    private contentType;
    private relayPath;
    private pocket;
    private pocketConfiguration;
    private redis;
    private pgPool;
    private databaseEncryptionKey;
    private processUID;
    applicationsRepository: ApplicationsRepository;
    private blockchainsRepository;
    private loadBalancersRepository;
    cherryPicker: CherryPicker;
    metricsRecorder: MetricsRecorder;
    pocketRelayer: PocketRelayer;
    constructor(secretKey: string, host: string, origin: string, userAgent: string, contentType: string, relayPath: string, pocket: Pocket, pocketConfiguration: Configuration, redis: Redis, pgPool: PGPool, databaseEncryptionKey: string, processUID: string, applicationsRepository: ApplicationsRepository, blockchainsRepository: BlockchainsRepository, loadBalancersRepository: LoadBalancersRepository);
    /**
     * Load Balancer Relay
     *
     * Send a Pocket Relay using a Gateway Load Balancer ID
     *
     * @param id Load Balancer ID
     */
    loadBalancerRelay(id: string, rawData: object, filter?: FilterExcludingWhere<Applications>): Promise<string>;
    /**
     * Application Relay
     *
     * Send a Pocket Relay using a specific Application's ID
     *
     * @param id Application ID
     */
    applicationRelay(id: string, rawData: object, filter?: FilterExcludingWhere<Applications>): Promise<string>;
    fetchRandomLoadBalancerApplication(id: string, applicationIDs: string[], filter: FilterExcludingWhere | undefined): Promise<Applications>;
    fetchApp(id: string, filter: FilterExcludingWhere | undefined): Promise<Applications>;
    checkDebug(): boolean;
}
