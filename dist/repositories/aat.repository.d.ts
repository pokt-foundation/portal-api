import { DefaultCrudRepository } from '@loopback/repository';
import { Aat, AatRelations } from '../models';
import { GatewayDataSource } from '../datasources';
export declare class AatRepository extends DefaultCrudRepository<Aat, typeof Aat.prototype.appPublicKey, AatRelations> {
    constructor(dataSource: GatewayDataSource);
}
