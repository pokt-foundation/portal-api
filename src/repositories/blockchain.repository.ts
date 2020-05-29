import {DefaultCrudRepository} from '@loopback/repository';
import {Blockchain, BlockchainRelations} from '../models';
import {GatewayDataSource} from '../datasources';
import {inject} from '@loopback/core';

export class BlockchainRepository extends DefaultCrudRepository<
  Blockchain,
  typeof Blockchain.prototype.hash,
  BlockchainRelations
> {
  constructor(
    @inject('datasources.gateway') dataSource: GatewayDataSource,
  ) {
    super(Blockchain, dataSource);
  }
}
