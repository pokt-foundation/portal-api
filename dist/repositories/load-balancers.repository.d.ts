import { DefaultCrudRepository } from '@loopback/repository';
import { LoadBalancers, LoadBalancersRelations } from '../models';
import { GatewayDataSource } from '../datasources';
export declare class LoadBalancersRepository extends DefaultCrudRepository<LoadBalancers, typeof LoadBalancers.prototype.id, LoadBalancersRelations> {
    constructor(dataSource: GatewayDataSource);
}
