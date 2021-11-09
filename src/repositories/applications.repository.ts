import { inject } from '@loopback/core'
import { DefaultCrudRepository } from '@loopback/repository'
import { GatewayDataSource } from '../datasources'
import { Applications, ApplicationsRelations } from '../models'

export class ApplicationsRepository extends DefaultCrudRepository<
  Applications,
  typeof Applications.prototype.id,
  ApplicationsRelations
> {
  constructor(@inject('datasources.gateway') dataSource: GatewayDataSource) {
    super(Applications, dataSource)
  }
}
