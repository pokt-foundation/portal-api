import { Entity } from '@loopback/repository';
export declare class Blockchains extends Entity {
    ticker: string;
    hash: string;
    networkID: string;
    network: string;
    description?: string;
    index: number;
    blockchain: string;
    active: boolean;
    syncCheck?: string;
    [prop: string]: any;
    constructor(data?: Partial<Blockchains>);
}
export interface BlockchainsRelations {
}
export declare type BlockchainsWithRelations = Blockchains & BlockchainsRelations;
