import { inject } from '@loopback/context'
import { Count, CountSchema, Filter } from '@loopback/repository'
import { param, get, getModelSchemaRef } from '@loopback/rest'
import { Blockchains, BlockchainsResponse } from '../models'
import { blockchainToBlockchainResponse } from '../models/blockchains.model'
import { PHDClient, PHDPaths } from '../services/phd-client'

export class BlockchainsController {
  constructor(@inject('phdClient') private phdClient: PHDClient) {}

  @get('/blockchains/count', {
    responses: {
      '200': {
        description: 'Blockchains model count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async count(): Promise<Count> {
    return this.phdClient.count({ path: PHDPaths.Blockchain })
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
    return (await this.phdClient.find<Blockchains>({ path: PHDPaths.Blockchain })).map(blockchainToBlockchainResponse)
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
  async findById(@param.path.string('id') id: string): Promise<BlockchainsResponse> {
    return blockchainToBlockchainResponse(await this.phdClient.findById({ path: PHDPaths.Blockchain, id }))
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
    const blockchains = await this.phdClient.find<Blockchains>({
      path: PHDPaths.Blockchain,
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
