import {DefaultCrudRepository} from '@loopback/repository';
import {Applications, ApplicationsRelations} from '../models';
import {GatewayDataSource} from '../datasources';
import {inject} from '@loopback/core';

export class ApplicationsRepository extends DefaultCrudRepository<
  Applications,
  typeof Applications.prototype.id,
  ApplicationsRelations
> {
  constructor(
    @inject('datasources.gateway') dataSource: GatewayDataSource,
  ) {
    super(Applications, dataSource);
  }
}
