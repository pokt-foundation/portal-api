import { DefaultCrudRepository } from '@loopback/repository'
import { Blockchains, BlockchainsRelations } from '../models'
import { GatewayDataSource } from '../datasources'
import { inject } from '@loopback/core'

export class BlockchainsRepository extends DefaultCrudRepository<
  Blockchains,
  typeof Blockchains.prototype.hash,
  BlockchainsRelations
> {
  constructor(@inject('datasources.gateway') dataSource: GatewayDataSource) {
    super(Blockchains, dataSource)
  }
}
