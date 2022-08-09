import { Count, CountSchema, Filter, FilterExcludingWhere, repository, Where } from '@loopback/repository'
import { param, get, getModelSchemaRef } from '@loopback/rest'
import { Blockchains } from '../models'
import { BlockchainsRepository } from '../repositories'

export class BlockchainsController {
  constructor(
    @repository(BlockchainsRepository)
    public blockchainsRepository: BlockchainsRepository
  ) {}

  @get('/blockchains/count', {
    responses: {
      '200': {
        description: 'Blockchains model count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async count(@param.where(Blockchains) where?: Where<Blockchains>): Promise<Count> {
    return this.blockchainsRepository.count(where)
  }

  @get('/blockchains', {
    responses: {
      '200': {
        description: 'Array of Blockchains model instances',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: getModelSchemaRef(Blockchains, { includeRelations: true }),
            },
          },
        },
      },
    },
  })
  async find(@param.filter(Blockchains) filter?: Filter<Blockchains>): Promise<Blockchains[]> {
    return this.blockchainsRepository.find(filter)
  }

  @get('/blockchains/{id}', {
    responses: {
      '200': {
        description: 'Blockchains model instance',
        content: {
          'application/json': {
            schema: getModelSchemaRef(Blockchains, { includeRelations: true }),
          },
        },
      },
    },
  })
  async findById(
    @param.path.string('id') id: string,
    @param.filter(Blockchains, { exclude: 'where' })
    filter?: FilterExcludingWhere<Blockchains>
  ): Promise<Blockchains> {
    return this.blockchainsRepository.findById(id, filter)
  }

  @get('/blockchains/ids', {
    responses: {
      '200': {
        description: 'Mapping of available blockchains and their API aliases',
        content: {
          'application/json': {
            schema: {
              items: getModelSchemaRef(Blockchains, { includeRelations: true }),
            },
          },
        },
      },
    },
  })
  async idsMapping(@param.filter(Blockchains) filter?: Filter<Blockchains>): Promise<object> {
    const blockchains = await this.blockchainsRepository.find(filter)

    const aliases = {}
    blockchains.forEach((blockchain) => {
      aliases[blockchain.description] = {
        id: blockchain.hash,
        prefix: blockchain.blockchainAliases,
      }
    })
    return aliases
  }
}
