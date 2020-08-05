import { DefaultCrudRepository } from '@loopback/repository';
import { Applications, ApplicationsRelations } from '../models';
import { GatewayDataSource } from '../datasources';
export declare class ApplicationsRepository extends DefaultCrudRepository<Applications, typeof Applications.prototype.id, ApplicationsRelations> {
    constructor(dataSource: GatewayDataSource);
}
