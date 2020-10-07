import { Entity } from '@loopback/repository';
export declare class Applications extends Entity {
    id: string;
    name?: string;
    owner?: string;
    url?: string;
    freeTier: boolean;
    publicPocketAccount?: object;
    freeTierApplicationAccount?: object;
    aat?: object;
    [prop: string]: any;
    constructor(data?: Partial<Applications>);
}
export interface ApplicationsRelations {
}
export declare type ApplicationsWithRelations = Applications & ApplicationsRelations;
