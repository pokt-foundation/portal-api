import { inject, lifeCycleObserver, LifeCycleObserver } from '@loopback/core'
import { juggler } from '@loopback/repository'
import { HttpErrors } from '@loopback/rest'

const mongoEndpoint: string = process.env.MONGO_ENDPOINT ?? ''

if (!mongoEndpoint) {
  throw new HttpErrors.InternalServerError('MONGO_ENDPOINT required in ENV')
}

const config = {
  name: 'gateway',
  connector: 'mongodb',
  url: mongoEndpoint,
  useNewUrlParser: true,
  useUnifiedTopology: true,
}

// Observe application's life cycle to disconnect the datasource when
// application is stopped. This allows the application to be shut down
// gracefully. The `stop()` method is inherited from `juggler.DataSource`.
// Learn more at https://loopback.io/doc/en/lb4/Life-cycle.html
@lifeCycleObserver('datasource')
export class GatewayDataSource extends juggler.DataSource implements LifeCycleObserver {
  static dataSourceName = 'gateway'
  static readonly defaultConfig = config

  constructor(
    @inject('datasources.config.gateway', { optional: true })
    dsConfig: object = config
  ) {
    super(dsConfig)
  }
}
