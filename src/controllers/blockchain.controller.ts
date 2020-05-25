import {
  Filter,
  repository,
} from '@loopback/repository';
import {
  param,
  get,
  getModelSchemaRef,
} from '@loopback/rest';
import {Blockchain} from '../models';
import {BlockchainRepository} from '../repositories';

export class BlockchainController {
  constructor(
    @repository(BlockchainRepository)
    public blockchainRepository : BlockchainRepository,
  ) {}

  @get('/blockchains', {
    responses: {
      '200': {
        description: 'Array of Blockchain model instances',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: getModelSchemaRef(Blockchain, {includeRelations: true}),
            },
          },
        },
      },
    },
  })
  async find(
    @param.filter(Blockchain) filter?: Filter<Blockchain>,
  ): Promise<Blockchain[]> {
    return this.blockchainRepository.find(filter);
  }
}
