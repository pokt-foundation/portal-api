import { Entity } from '@loopback/repository';
export declare class Aat extends Entity {
    appPubKey: string;
    version: string;
    clientPubKey: string;
    signature: string;
    secretKey: string;
    [prop: string]: any;
    constructor(data?: Partial<Aat>);
}
export interface AatRelations {
}
export declare type AatWithRelations = Aat & AatRelations;
