import { Entity, model, property } from '@loopback/repository'

@model({ settings: { strict: true } })
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
    // required: true,
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

export type GatewaySettings = {
  whitelistOrigins: string[]
  whitelistUserAgents: string[]
  whitelistBlockchains?: string[]
  whitelistContracts?: WhitelistContract[]
  whitelistMethods?: WhitelistMethod[]
  secretKeyRequired: boolean
  secretKey: string
}

export type WhitelistContract = {
  blockchainID: string
  contracts: string[]
}

export type WhitelistMethod = {
  blockchainID: string
  methods: string[]
}
