import { Entity } from '@loopback/repository';
export declare class PocketApplication extends Entity {
    appPubKey: string;
    version: string;
    clientPubKey: string;
    signature: string;
    secretKey: string;
    secretKeyRequired: boolean;
    whitelistOrigins: string[];
    whitelistAddresses: string[];
    whitelistUserAgents: string[];
    [prop: string]: any;
    constructor(data?: Partial<PocketApplication>);
}
export interface PocketApplicationRelations {
}
export declare type PocketApplicationWithRelations = PocketApplication & PocketApplicationRelations;
