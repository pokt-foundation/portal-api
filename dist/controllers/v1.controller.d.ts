import { FilterExcludingWhere } from '@loopback/repository';
import { PocketApplication } from '../models';
import { PocketApplicationRepository } from '../repositories';
import { Pocket } from '@pokt-network/pocket-js';
import { Redis } from 'ioredis';
export declare class V1Controller {
    private secretKey;
    private blockchain;
    private origin;
    private userAgent;
    private pocket;
    private redis;
    pocketApplicationRepository: PocketApplicationRepository;
    constructor(secretKey: string, blockchain: string, origin: string, userAgent: string, pocket: Pocket, redis: Redis, pocketApplicationRepository: PocketApplicationRepository);
    attemptRelay(id: string, data: any, filter?: FilterExcludingWhere<PocketApplication>): Promise<string>;
    checkWhitelist(tests: string[], check: string, type: string): boolean;
}
