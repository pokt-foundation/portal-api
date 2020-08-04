import { Filter } from '@loopback/repository';
import { Blockchain } from '../models';
import { BlockchainRepository } from '../repositories';
export declare class BlockchainController {
    blockchainRepository: BlockchainRepository;
    constructor(blockchainRepository: BlockchainRepository);
    find(filter?: Filter<Blockchain>): Promise<Blockchain[]>;
}
