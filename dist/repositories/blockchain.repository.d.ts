import { DefaultCrudRepository } from '@loopback/repository';
import { Blockchain, BlockchainRelations } from '../models';
import { GatewayDataSource } from '../datasources';
export declare class BlockchainRepository extends DefaultCrudRepository<Blockchain, typeof Blockchain.prototype.hash, BlockchainRelations> {
    constructor(dataSource: GatewayDataSource);
}
