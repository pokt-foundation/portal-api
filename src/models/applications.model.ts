import {Entity, model, property} from '@loopback/repository';

@model({settings: {strict: false}})
export class Applications extends Entity {
  @property({
    type: 'string',
    id: true,
    generated: true,
  })
  id?: string;

  @property({
    type: 'string',
  })
  name?: string;

  @property({
    type: 'string',
  })
  owner?: string;

  @property({
    type: 'string',
  })
  url?: string;

  @property({
    type: 'boolean',
    required: true,
  })
  freeTier: boolean;

  @property({
    type: 'object',
  })
  publicPocketAccount?: object;

  @property({
    type: 'object',
  })
  freeTierApplicationAccount?: object;

  @property({
    type: 'object',
  })
  aat?: object;

  // Define well-known properties here

  // Indexer property to allow additional data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [prop: string]: any;

  constructor(data?: Partial<Applications>) {
    super(data);
  }
}

export interface ApplicationsRelations {
  // describe navigational properties here
}

export type ApplicationsWithRelations = Applications & ApplicationsRelations;
