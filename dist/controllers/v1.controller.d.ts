import { Count, Filter, FilterExcludingWhere, Where } from '@loopback/repository';
import { Aat } from '../models';
import { AatRepository } from '../repositories';
export declare class V1Controller {
    private secretKey;
    private blockchain;
    aatRepository: AatRepository;
    constructor(secretKey: string, blockchain: string, aatRepository: AatRepository);
    create(aat: Aat): Promise<Aat>;
    count(where?: Where<Aat>): Promise<Count>;
    find(filter?: Filter<Aat>): Promise<Aat[]>;
    findById(id: string, filter?: FilterExcludingWhere<Aat>): Promise<Aat>;
    attemptRelay(id: string, data: any, filter?: FilterExcludingWhere<Aat>): Promise<string>;
}
