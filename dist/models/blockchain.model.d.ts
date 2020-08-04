import { Entity } from '@loopback/repository';
export declare class Blockchain extends Entity {
    blockchain: string;
    hash: string;
    constructor(data?: Partial<Blockchain>);
}
export interface BlockchainRelations {
}
export declare type BlockchainWithRelations = Blockchain & BlockchainRelations;
