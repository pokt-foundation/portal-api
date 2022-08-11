import { Count, CountSchema, Filter, FilterExcludingWhere, repository, Where } from '@loopback/repository'
import { param, get, getModelSchemaRef } from '@loopback/rest'

import { Blockchains } from '../models'
import { PHDClient } from '../phd-client'
import { BlockchainsRepository } from '../repositories'

export class BlockchainsController {
  phdClient: PHDClient

  constructor(
    @repository(BlockchainsRepository)
    public blockchainsRepository: BlockchainsRepository
  ) {
    this.phdClient = new PHDClient()
  }

  @get('/blockchains/count', {
    responses: {
      '200': {
        description: 'Blockchains model count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async count(@param.where(Blockchains) where?: Where<Blockchains>): Promise<Count> {
    return this.phdClient.count({
      path: 'blockchains',
      model: Blockchains,
      fallback: () => this.blockchainsRepository.count(where),
    })
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
    return this.phdClient.find({
      path: 'blockchain',
      model: Blockchains,
      fallback: () => this.blockchainsRepository.find(filter),
    })
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
    return this.phdClient.findById({
      path: 'blockchain',
      id,
      model: Blockchains,
      fallback: () => this.blockchainsRepository.findById(id, filter),
    })
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
    const blockchains = await this.phdClient.find({
      path: 'blockchain',
      model: Blockchains,
      fallback: () => this.blockchainsRepository.find(filter),
    })

    const aliases = {}

    blockchains.forEach(({ id, blockchainAliases, description }) => {
      aliases[description] = {
        id: id,
        prefix: blockchainAliases,
      }
    })

    return aliases
  }
}
