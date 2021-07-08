import { Count, CountSchema, Filter, FilterExcludingWhere, repository, Where } from '@loopback/repository'
import { post, param, get, getModelSchemaRef, patch, put, del, requestBody } from '@loopback/rest'
import { Blockchains } from '../models'
import { BlockchainsRepository } from '../repositories'

export class BlockchainsController {
  constructor(
    @repository(BlockchainsRepository)
    public blockchainsRepository: BlockchainsRepository
  ) {}

  @post('/blockchains', {
    responses: {
      '200': {
        description: 'Blockchains model instance',
        content: {
          'application/json': { schema: getModelSchemaRef(Blockchains) },
        },
      },
    },
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Blockchains, {
            title: 'NewBlockchains',
          }),
        },
      },
    })
    blockchains: Blockchains
  ): Promise<Blockchains> {
    return this.blockchainsRepository.create(blockchains)
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

  @patch('/blockchains', {
    responses: {
      '200': {
        description: 'Blockchains PATCH success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Blockchains, { partial: true }),
        },
      },
    })
    blockchains: Blockchains,
    @param.where(Blockchains) where?: Where<Blockchains>
  ): Promise<Count> {
    return this.blockchainsRepository.updateAll(blockchains, where)
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

  @patch('/blockchains/{id}', {
    responses: {
      '204': {
        description: 'Blockchains PATCH success',
      },
    },
  })
  async updateById(
    @param.path.string('id') id: string,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Blockchains, { partial: true }),
        },
      },
    })
    blockchains: Blockchains
  ): Promise<void> {
    await this.blockchainsRepository.updateById(id, blockchains)
  }

  @put('/blockchains/{id}', {
    responses: {
      '204': {
        description: 'Blockchains PUT success',
      },
    },
  })
  async replaceById(@param.path.string('id') id: string, @requestBody() blockchains: Blockchains): Promise<void> {
    await this.blockchainsRepository.replaceById(id, blockchains)
  }

  @del('/blockchains/{id}', {
    responses: {
      '204': {
        description: 'Blockchains DELETE success',
      },
    },
  })
  async deleteById(@param.path.string('id') id: string): Promise<void> {
    await this.blockchainsRepository.deleteById(id)
  }
}
