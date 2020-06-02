import { DefaultCrudRepository } from '@loopback/repository';
import { PocketApplication, PocketApplicationRelations } from '../models';
import { GatewayDataSource } from '../datasources';
export declare class PocketApplicationRepository extends DefaultCrudRepository<PocketApplication, typeof PocketApplication.prototype.appPublicKey, PocketApplicationRelations> {
    constructor(dataSource: GatewayDataSource);
}
