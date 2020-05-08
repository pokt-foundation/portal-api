import {DefaultCrudRepository} from '@loopback/repository';
import {Aat, AatRelations} from '../models';
import {GatewayDataSource} from '../datasources';
import {inject} from '@loopback/core';

export class AatRepository extends DefaultCrudRepository<
  Aat,
  typeof Aat.prototype.appPublicKey,
  AatRelations
> {
  constructor(
    @inject('datasources.gateway') dataSource: GatewayDataSource,
  ) {
    super(Aat, dataSource);
  }
}
