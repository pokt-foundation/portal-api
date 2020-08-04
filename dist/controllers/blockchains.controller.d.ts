import { Count, Filter, FilterExcludingWhere, Where } from '@loopback/repository';
import { Blockchains } from '../models';
import { BlockchainsRepository } from '../repositories';
export declare class BlockchainsController {
    blockchainsRepository: BlockchainsRepository;
    constructor(blockchainsRepository: BlockchainsRepository);
    create(blockchains: Blockchains): Promise<Blockchains>;
    count(where?: Where<Blockchains>): Promise<Count>;
    find(filter?: Filter<Blockchains>): Promise<Blockchains[]>;
    updateAll(blockchains: Blockchains, where?: Where<Blockchains>): Promise<Count>;
    findById(id: string, filter?: FilterExcludingWhere<Blockchains>): Promise<Blockchains>;
    updateById(id: string, blockchains: Blockchains): Promise<void>;
    replaceById(id: string, blockchains: Blockchains): Promise<void>;
    deleteById(id: string): Promise<void>;
}
