import { FilterExcludingWhere } from "@loopback/repository";
import { PocketApplication } from "../models";
import { PocketApplicationRepository, BlockchainRepository } from "../repositories";
import { Pocket, Configuration, Session, Node } from "@pokt-network/pocket-js";
import { Redis } from "ioredis";
import { Pool as PGPool } from "pg";
export declare class V1Controller {
    private secretKey;
    private host;
    private origin;
    private userAgent;
    private pocket;
    private pocketConfiguration;
    private redis;
    private pgPool;
    private processUID;
    pocketApplicationRepository: PocketApplicationRepository;
    private blockchainRepository;
    constructor(secretKey: string, host: string, origin: string, userAgent: string, pocket: Pocket, pocketConfiguration: Configuration, redis: Redis, pgPool: PGPool, processUID: string, pocketApplicationRepository: PocketApplicationRepository, blockchainRepository: BlockchainRepository);
    attemptRelay(id: string, data: any, filter?: FilterExcludingWhere<PocketApplication>): Promise<string>;
    checkWhitelist(tests: string[], check: string, type: string): boolean;
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
