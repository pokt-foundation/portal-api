import { DefaultCrudRepository } from '@loopback/repository';
import { Blockchains, BlockchainsRelations } from '../models';
import { GatewayDataSource } from '../datasources';
export declare class BlockchainsRepository extends DefaultCrudRepository<Blockchains, typeof Blockchains.prototype.hash, BlockchainsRelations> {
    constructor(dataSource: GatewayDataSource);
}
