import { inject } from '@loopback/core'
import { DefaultCrudRepository } from '@loopback/repository'
import { GatewayDataSource } from '../datasources'
import { LoadBalancers, LoadBalancersRelations } from '../models'

export class LoadBalancersRepository extends DefaultCrudRepository<
  LoadBalancers,
  typeof LoadBalancers.prototype.id,
  LoadBalancersRelations
> {
  constructor(@inject('datasources.gateway') dataSource: GatewayDataSource) {
    super(LoadBalancers, dataSource)
  }
}
