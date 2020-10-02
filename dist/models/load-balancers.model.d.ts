import { Entity } from '@loopback/repository';
export declare class LoadBalancers extends Entity {
    id?: string;
    user: string;
    name: string;
    applicationIDs: string[];
    [prop: string]: any;
    constructor(data?: Partial<LoadBalancers>);
}
export interface LoadBalancersRelations {
}
export declare type LoadBalancersWithRelations = LoadBalancers & LoadBalancersRelations;
