import {DefaultCrudRepository} from '@loopback/repository';
import {PocketApplication, PocketApplicationRelations} from '../models';
import {GatewayDataSource} from '../datasources';
import {inject} from '@loopback/core';

export class PocketApplicationRepository extends DefaultCrudRepository<
  PocketApplication,
  typeof PocketApplication.prototype.appPublicKey,
  PocketApplicationRelations
> {
  constructor(
    @inject('datasources.gateway') dataSource: GatewayDataSource,
  ) {
    super(PocketApplication, dataSource);
  }
}
