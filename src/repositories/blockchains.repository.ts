import { inject } from '@loopback/core'
import { DefaultCrudRepository } from '@loopback/repository'
import { GatewayDataSource } from '../datasources'
import { Blockchains, BlockchainsRelations } from '../models'

export class BlockchainsRepository extends DefaultCrudRepository<
  Blockchains,
  typeof Blockchains.prototype.hash,
  BlockchainsRelations
> {
  constructor(@inject('datasources.gateway') dataSource: GatewayDataSource) {
    super(Blockchains, dataSource)
  }
}
