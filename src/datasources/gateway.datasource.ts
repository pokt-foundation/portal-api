import {inject, lifeCycleObserver, LifeCycleObserver} from '@loopback/core';
import {juggler} from '@loopback/repository';

const config = {
  name: 'gateway',
  connector: 'mongodb',
  url: '',
  host: 'localhost',
  port: 32768,
  user: '',
  password: '',
  database: 'gateway',
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

// Observe application's life cycle to disconnect the datasource when
// application is stopped. This allows the application to be shut down
// gracefully. The `stop()` method is inherited from `juggler.DataSource`.
// Learn more at https://loopback.io/doc/en/lb4/Life-cycle.html
@lifeCycleObserver('datasource')
export class GatewayDataSource extends juggler.DataSource
  implements LifeCycleObserver {
  static dataSourceName = 'gateway';
  static readonly defaultConfig = config;

  constructor(
    @inject('datasources.config.gateway', {optional: true})
    dsConfig: object = config,
  ) {
    super(dsConfig);
  }
}
