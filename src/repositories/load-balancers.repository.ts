import { DefaultCrudRepository } from '@loopback/repository'
import { LoadBalancers, LoadBalancersRelations } from '../models'
import { GatewayDataSource } from '../datasources'
import { inject } from '@loopback/core'

export class LoadBalancersRepository extends DefaultCrudRepository<
  LoadBalancers,
  typeof LoadBalancers.prototype.id,
  LoadBalancersRelations
> {
  constructor(@inject('datasources.gateway') dataSource: GatewayDataSource) {
    super(LoadBalancers, dataSource)
  }
}
