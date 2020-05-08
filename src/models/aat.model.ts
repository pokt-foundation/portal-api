import {Entity, model, property} from '@loopback/repository';

@model({settings: {strict: false}})
export class Aat extends Entity {
  @property({
    type: 'string',
    id: true,
    generated: false,
    required: true,
  })
  appPubKey: string;

  @property({
    type: 'string',
    required: true,
    default: '0.0.1',
  })
  version: string;

  @property({
    type: 'string',
    required: true,
  })
  clientPubKey: string;

  @property({
    type: 'string',
    required: true,
  })
  signature: string;

  @property({
    type: 'string',
    required: true,
  })
  secretKey: string;

  // Define well-known properties here

  // Indexer property to allow additional data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [prop: string]: any;

  constructor(data?: Partial<Aat>) {
    super(data);
  }
}

export interface AatRelations {
  // describe navigational properties here
}

export type AatWithRelations = Aat & AatRelations;
