import {Entity, model, property} from '@loopback/repository';

@model({settings: {strict: false}})
export class PocketApplication extends Entity {
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

  @property({
    type: 'boolean',
    required: true,
    default: true
  })
  secretKeyRequired: boolean;

  @property.array(String)
  whitelistOrigins: string[];

  @property.array(String)
  whitelistAddresses: string[];

  @property.array(String)
  whitelistUserAgents: string[];

  // Define well-known properties here

  // Indexer property to allow additional data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [prop: string]: any;

  constructor(data?: Partial<PocketApplication>) {
    super(data);
  }
}

export interface PocketApplicationRelations {
  // describe navigational properties here
}

export type PocketApplicationWithRelations = PocketApplication & PocketApplicationRelations;
