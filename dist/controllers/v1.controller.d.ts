import { Count, Filter, FilterExcludingWhere, Where } from '@loopback/repository';
import { PocketApplication } from '../models';
import { PocketApplicationRepository } from '../repositories';
import { Pocket } from '@pokt-network/pocket-js';
export declare class V1Controller {
    private secretKey;
    private blockchain;
    private origin;
    private userAgent;
    private pocketInstance;
    pocketApplicationRepository: PocketApplicationRepository;
    constructor(secretKey: string, blockchain: string, origin: string, userAgent: string, pocketInstance: Pocket, pocketApplicationRepository: PocketApplicationRepository);
    create(pocketApplication: PocketApplication): Promise<PocketApplication>;
    count(where?: Where<PocketApplication>): Promise<Count>;
    find(filter?: Filter<PocketApplication>): Promise<PocketApplication[]>;
    findById(id: string, filter?: FilterExcludingWhere<PocketApplication>): Promise<PocketApplication>;
    attemptRelay(id: string, data: any, filter?: FilterExcludingWhere<PocketApplication>): Promise<string>;
    checkWhitelist(tests: string[], check: string, type: string): boolean;
}
