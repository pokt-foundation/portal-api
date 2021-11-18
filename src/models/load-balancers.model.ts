import { Entity, model, property } from '@loopback/repository'

@model({ settings: { strict: false } })
export class LoadBalancers extends Entity {
  @property({
    type: 'string',
    id: true,
  })
  id?: string

  @property({
    type: 'string',
    required: true,
  })
  user: string

  @property({
    type: 'string',
    required: false,
  })
  name: string

  @property({
    type: 'array',
    itemType: 'string',
    required: true,
  })
  applicationIDs: string[]

  @property({
    type: 'number',
  })
  logLimitBlocks?: number

  @property({
    type: 'boolean',
    required: false,
  })
  stickiness?: boolean

  @property({
    type: 'number',
    required: false,
  })
  stickinessDuration?: number;

  // Define well-known properties here

  // Indexer property to allow additional data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [prop: string]: any

  constructor(data?: Partial<LoadBalancers>) {
    super(data)
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface LoadBalancersRelations {
  // describe navigational properties here
}

export type LoadBalancersWithRelations = LoadBalancers & LoadBalancersRelations
