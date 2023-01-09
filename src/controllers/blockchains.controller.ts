import { inject } from '@loopback/context'
import { Count, CountSchema, Filter, FilterExcludingWhere, repository, Where } from '@loopback/repository'
import { param, get, getModelSchemaRef } from '@loopback/rest'

import { Blockchains, BlockchainsResponse } from '../models'
import { blockchainToBlockchainResponse } from '../models/blockchains.model'
import { BlockchainsRepository } from '../repositories'
import { PHDClient, PHDPaths } from '../services/phd-client'

export class BlockchainsController {
  constructor(
    @inject('phdClient') private phdClient: PHDClient,
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
    return this.phdClient.count({
      path: PHDPaths.Blockchain,
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
  async find(@param.filter(Blockchains) filter?: Filter<Blockchains>): Promise<BlockchainsResponse[]> {
    return (
      await this.phdClient.find({
        path: PHDPaths.Blockchain,
        model: Blockchains,
        fallback: () => this.blockchainsRepository.find(filter),
      })
    ).map((bl) => blockchainToBlockchainResponse(bl))
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
  ): Promise<BlockchainsResponse> {
    return blockchainToBlockchainResponse(
      await this.phdClient.findById({
        path: PHDPaths.Blockchain,
        id,
        model: Blockchains,
        fallback: () => this.blockchainsRepository.findById(id, filter),
      })
    )
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
      path: PHDPaths.Blockchain,
      model: Blockchains,
      fallback: () => this.blockchainsRepository.find(filter),
    })

    const aliases = {}

    blockchains.forEach(({ id, blockchainAliases, description }) => {
      aliases[description] = {
        id,
        prefix: blockchainAliases,
      }
    })

    return aliases
  }
}
