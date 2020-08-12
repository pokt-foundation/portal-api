import { FilterExcludingWhere } from "@loopback/repository";
import { Applications } from "../models";
import { ApplicationsRepository, BlockchainsRepository } from "../repositories";
import { Pocket, Configuration, Session, Node } from "@pokt-network/pocket-js";
import { Redis } from "ioredis";
import { Pool as PGPool } from "pg";
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
    constructor(secretKey: string, host: string, origin: string, userAgent: string, contentType: string, relayPath: string, pocket: Pocket, pocketConfiguration: Configuration, redis: Redis, pgPool: PGPool, databaseEncryptionKey: string, processUID: string, applicationsRepository: ApplicationsRepository, blockchainsRepository: BlockchainsRepository);
    attemptRelay(id: string, rawData: object, filter?: FilterExcludingWhere<Applications>): Promise<string>;
    checkWhitelist(tests: string[], check: string, type: string): boolean;
    checkDebug(): boolean;
    recordMetric({ appPubKey, blockchain, serviceNode, elapsedStart, result, bytes, }: {
        appPubKey: string;
        blockchain: string;
        serviceNode: string | undefined;
        elapsedStart: [number, number];
        result: number;
        bytes: number;
    }): Promise<void>;
    updateServiceNodeQuality(blockchain: string, serviceNode: string, elapsedTime: number, result: number): Promise<void>;
    fetchServiceLog(blockchain: string, serviceNode: string): Promise<string | null>;
    cherryPickNode(pocketSession: Session, blockchain: string): Promise<Node>;
}
