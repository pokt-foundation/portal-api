import {Entity, model, property} from '@loopback/repository';

@model({settings: {strict: false}})
export class Blockchains extends Entity {
  @property({
    type: 'string',
    required: true,
  })
  ticker: string;

  @property({
    type: 'string',
    id: true,
    generated: false,
    required: true,
  })
  hash: string;

  @property({
    type: 'string',
    required: true,
  })
  networkID: string;

  @property({
    type: 'string',
    required: true,
  })
  network: string;

  @property({
    type: 'string',
  })
  description?: string;

  @property({
    type: 'number',
    required: true,
  })
  index: number;

  @property({
    type: 'string',
    required: true,
  })
  blockchain: string;

  @property({
    type: 'boolean',
    required: true,
    default: true,
  })
  active: boolean;

  @property({
    type: 'string',
  })
  syncCheck?: string;

  // Indexer property to allow additional data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [prop: string]: any;

  constructor(data?: Partial<Blockchains>) {
    super(data);
  }
}

export interface BlockchainsRelations {
  // describe navigational properties here
}

export type BlockchainsWithRelations = Blockchains & BlockchainsRelations;
