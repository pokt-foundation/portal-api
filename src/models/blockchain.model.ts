import {Entity, model, property} from '@loopback/repository';

@model()
export class Blockchain extends Entity {
  @property({
    type: 'string',
    required: true,
  })
  blockchain: string;

  @property({
    type: 'string',
    id: true,
    generated: false,
    required: true,
  })
  hash: string;


  constructor(data?: Partial<Blockchain>) {
    super(data);
  }
}

export interface BlockchainRelations {
  // describe navigational properties here
}

export type BlockchainWithRelations = Blockchain & BlockchainRelations;
