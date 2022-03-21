import { Entity, model, property } from '@loopback/repository'
import { StickinessOptions } from './load-balancers.model'

@model({ settings: { strict: false } })
export class Applications extends Entity {
  @property({
    type: 'string',
    id: true,
    required: true,
  })
  id: string

  @property({
    type: 'string',
  })
  name?: string

  @property({
    type: 'string',
  })
  owner?: string

  @property({
    type: 'string',
  })
  url?: string

  @property({
    type: 'boolean',
    required: true,
  })
  freeTier: boolean

  @property({
    type: 'object',
  })
  publicPocketAccount?: PocketAccount

  @property({
    type: 'object',
  })
  freeTierApplicationAccount?: PocketAccount

  @property({
    type: 'object',
  })
  aat?: object

  @property({
    type: 'boolean',
    required: false,
  })
  stickiness?: boolean

  @property({
    type: 'number',
    required: false,
  })
  stickinessDuration?: number

  @property({
    type: 'object',
    required: false,
    defautl: {},
  })
  stickinessOptions?: StickinessOptions

  @property({
    type: 'object',
    required: true,
  })
  gatewayAAT: GatewayAAT

  @property({
    type: 'object',
    required: true,
  })
  gatewaySettings: GatewaySettings;

  // Define well-known properties here

  // Indexer property to allow additional data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [prop: string]: any

  constructor(data?: Partial<Applications>) {
    super(data)
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ApplicationsRelations {
  // describe navigational properties here
}

export type ApplicationsWithRelations = Applications & ApplicationsRelations

export type PocketAccount = {
  address: string
  publicKey: string
  privateKey?: string
}

type GatewayAAT = {
  version: string
  clientPublicKey: string
  applicationPublicKey: string
  applicationSignature: string
}

type GatewaySettings = {
  whitelistOrigins: string[]
  whitelistUserAgents: string[]
  secretKeyRequired: boolean
  secretKey: string
}
