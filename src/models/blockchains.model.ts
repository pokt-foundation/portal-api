import { Entity, model, property } from '@loopback/repository'

@model()
class SyncCheckOptions {
  @property({
    type: 'string',
  })
  path?: string

  @property({
    type: 'string',
    required: true,
  })
  body: string

  @property({
    type: 'string',
    required: true,
  })
  resultKey: string

  @property({
    type: 'number',
  })
  allowance?: number
}

@model()
class BlockchainRedirect {
  @property({
    type: 'string',
    required: true,
  })
  alias: string

  @property({
    type: 'string',
    required: true,
  })
  domain: string

  @property({
    type: 'string',
    required: true,
  })
  loadBalancerID: string
}

@model({ settings: { strict: false } })
export class Blockchains extends Entity {
  @property({
    type: 'string',
    required: true,
  })
  ticker: string

  @property({
    type: 'string',
    id: true,
    generated: false,
    required: true,
  })
  id: string

  @property({
    type: 'string',
    generated: false,
    required: true,
  })
  chainID: string

  @property({
    type: 'string',
    required: true,
  })
  networkID: string

  @property({
    type: 'string',
    required: true,
  })
  network: string

  @property({
    type: 'string',
  })
  description?: string

  @property({
    type: 'number',
    required: true,
  })
  index: number

  @property({
    type: 'string',
    required: true,
  })
  blockchain: string

  @property({
    type: 'array',
    itemType: 'string',
    required: true,
  })
  blockchainAliases: string[]

  @property({
    type: 'boolean',
    required: true,
    default: true,
  })
  active: boolean

  @property({
    type: 'string',
  })
  syncCheck?: string

  @property({
    type: 'object',
  })
  syncCheckOptions?: SyncCheckOptions

  @property({
    type: 'number',
  })
  logLimitBlocks?: number

  @property({
    type: 'string',
    required: false,
    default: '',
  })
  path?: string

  // TODO - Verify if fields can be removed
  // @property({
  //   type: 'boolean',
  // })
  // evm?: boolean

  @property({
    type: 'string',
  })
  altruist?: string

  @property({
    type: 'object',
  })
  redirects?: BlockchainRedirect[];

  // Indexer property to allow additional data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [prop: string]: any

  constructor(data?: Partial<Blockchains>) {
    super(data)
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface BlockchainsRelations {
  // describe navigational properties here
}

export type BlockchainsWithRelations = Blockchains & BlockchainsRelations
