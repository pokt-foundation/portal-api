import { inject, lifeCycleObserver, LifeCycleObserver } from '@loopback/core'
import { juggler } from '@loopback/repository'
import { HttpErrors } from '@loopback/rest'

// FIXME: on testing, the environment variable has to be set manually to a dummy
// due to the loopback loading data sources loaded before any code from us, so
// we cannot intercept the instance to mock the value or do anything else.
// Try to find a way to intercept the instance before is loaded
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
