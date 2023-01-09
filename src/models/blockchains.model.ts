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
  hash: string

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

  @property({
    type: 'boolean',
  })
  evm?: boolean

  @property({
    type: 'string',
  })
  altruist?: string

  @property({
    type: 'string',
    required: false,
  })
  enforceResult: string

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

export type BlockchainsResponse = {
  ticker: string
  hash: string
  networkID: string
  network: string
  description?: string
  index: number
  blockchain: string
  blockchainAliases: string[]
  active: boolean
  syncCheckOptions?: {
    path?: string
    body: string
    resultKey: string
    allowance?: number
  }
  enforceResult?: string
  logLimitBlocks?: number
  path?: string
  evm?: boolean
  redirects?: {
    alias: string
    domain: string
  }[]
}

export function blockchainToBlockhainResponse(bl: Blockchains): BlockchainsResponse {
  return {
    ticker: bl.ticker,
    hash: bl.hash,
    networkID: bl.networkID,
    network: bl.network,
    description: bl.description,
    index: bl.index,
    blockchain: bl.blockchain,
    blockchainAliases: bl.blockchainAliases,
    active: bl.active,
    syncCheckOptions: {
      path: bl?.syncCheckOptions?.path,
      body: bl?.syncCheckOptions?.body,
      resultKey: bl?.syncCheckOptions?.resultKey,
      allowance: bl?.syncCheckOptions?.allowance,
    },
    enforceResult: bl?.enforceResult,
    logLimitBlocks: bl?.logLimitBlocks,
    path: bl?.path,
    evm: bl?.evm,
    redirects: bl?.redirects,
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface BlockchainsRelations {
  // describe navigational properties here
}

export type BlockchainsWithRelations = Blockchains & BlockchainsRelations
