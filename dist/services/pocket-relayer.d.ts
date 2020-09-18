import { CherryPicker } from '../services/cherry-picker';
import { MetricsRecorder } from '../services/metrics-recorder';
import { Pocket, Configuration } from '@pokt-network/pocket-js';
import { Redis } from 'ioredis';
import { BlockchainsRepository } from "../repositories";
import { Applications } from '../models';
export declare class PocketRelayer {
    host: string;
    origin: string;
    userAgent: string;
    pocket: Pocket;
    pocketConfiguration: Configuration;
    cherryPicker: CherryPicker;
    metricsRecorder: MetricsRecorder;
    redis: Redis;
    databaseEncryptionKey: string;
    secretKey: string;
    relayPath: string;
    checkDebug: boolean;
    blockchainsRepository: BlockchainsRepository;
    constructor(host: string, origin: string, userAgent: string, pocket: Pocket, pocketConfiguration: Configuration, cherryPicker: CherryPicker, metricsRecorder: MetricsRecorder, redis: Redis, databaseEncryptionKey: string, secretKey: string, relayPath: string, blockchainsRepository: BlockchainsRepository, checkDebug: boolean);
    sendRelay(rawData: object, application: Applications): Promise<string>;
    loadBlockchain(): Promise<string[]>;
    checkEnforcementJSON(test: string): boolean;
    checkSecretKey(application: Applications): boolean;
    checkWhitelist(tests: string[], check: string, type: string): boolean;
}
