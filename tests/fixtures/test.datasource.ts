import { inject, lifeCycleObserver, LifeCycleObserver } from '@loopback/core'
import { juggler } from '@loopback/repository'

const config = {
  name: 'gateway',
  connector: 'memory',
}

@lifeCycleObserver('datasource')
export class TestDataSource extends juggler.DataSource implements LifeCycleObserver {
  static dataSourceName = 'gateway'
  static readonly defaultConfig = config

  constructor(
    @inject('datasources.config.gateway', { optional: true })
    dsConfig: object = config
  ) {
    super(dsConfig)
  }
}

export const gatewayTestDB = new TestDataSource()
