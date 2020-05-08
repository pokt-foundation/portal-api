import { ApplicationConfig } from '@loopback/core';
import { RestApplication } from '@loopback/rest';
declare const PocketGatewayApplication_base: (new (...args: any[]) => {
    [x: string]: any;
    projectRoot: string;
    bootOptions?: import("@loopback/boot").BootOptions | undefined;
    boot(): Promise<void>;
    booters(...booterCls: import("@loopback/core").Constructor<import("@loopback/boot").Booter>[]): import("@loopback/boot").Binding<any>[];
    component(component: import("@loopback/core").Constructor<{}>): void;
    mountComponentBooters(component: import("@loopback/core").Constructor<{}>): void;
}) & (new (...args: any[]) => {
    [x: string]: any;
    serviceProvider<S>(provider: import("@loopback/service-proxy").Class<import("@loopback/core").Provider<S>>, name?: string | undefined): import("@loopback/boot").Binding<S>;
    component(component: import("@loopback/service-proxy").Class<unknown>, name?: string | undefined): void;
    mountComponentServices(component: import("@loopback/service-proxy").Class<unknown>): void;
}) & (new (...args: any[]) => {
    [x: string]: any;
    repository<R extends import("@loopback/repository").Repository<any>>(repoClass: import("@loopback/repository").Class<R>, name?: string | undefined): import("@loopback/boot").Binding<R>;
    getRepository<R_1 extends import("@loopback/repository").Repository<any>>(repo: import("@loopback/repository").Class<R_1>): Promise<R_1>;
    dataSource<D extends import("loopback-datasource-juggler").DataSource>(dataSource: D | import("@loopback/repository").Class<D>, name?: string | undefined): import("@loopback/boot").Binding<D>;
    component(component: import("@loopback/repository").Class<unknown>, name?: string | undefined): void;
    mountComponentRepositories(component: import("@loopback/repository").Class<unknown>): void;
    migrateSchema(options?: import("@loopback/repository").SchemaMigrationOptions | undefined): Promise<void>;
}) & typeof RestApplication;
export declare class PocketGatewayApplication extends PocketGatewayApplication_base {
    constructor(options?: ApplicationConfig);
}
export {};
