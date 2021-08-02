import {
  inject,
  /* inject, Application, CoreBindings, */
  lifeCycleObserver, // The decorator
  LifeCycleObserver, // The interface
} from '@loopback/core'

/**
 * This class will be bound to the application as a `LifeCycleObserver` during
 * `boot`
 */
@lifeCycleObserver('configuration')
export class EnvironmentObserver implements LifeCycleObserver {
  // TODO: split the arrays on optional and require
  private static environment: string[] = [
    'NODE_ENV',
    'GATEWAY_CLIENT_PRIVATE_KEY',
    'GATEWAY_CLIENT_PASSPHRASE',
    'MONGO_ENDPOINT',
    'DATABASE_ENCRYPTION_KEY',
    'REDIS_ENDPOINT',
    'REDIS_PORT',
    'PG_CONNECTION',
    'PG_CERTIFICATE',
    'PSQL_CONNECTION',
    'INFLUX_URL',
    'INFLUX_TOKEN',
    'INFLUX_ORG',
    'LOGZ_TOKEN',
    'DISPATCH_URL',
    'ALTRUISTS',
    'POCKET_SESSION_BLOCK_FREQUENCY',
    'POCKET_BLOCK_TIME',
    'POCKET_RELAY_RETRIES',
    'DEFAULT_SYNC_ALLOWANCE',
    'LOG_LIMIT_BLOCKS',
    'AAT_PLAN',
    'WATCH',
  ]

  /*
  constructor(
    @inject(CoreBindings.APPLICATION_INSTANCE) private app: Application,
  ) {}
  */

  /**
   * This method will be invoked when the application initializes. It will be
   * called at most once for a given application instance.
   */
  async init(
    @inject('configuration.environment.load') load: boolean,
    @inject('configuration.environment.values') configValues: object
  ): Promise<void> {
    // TODO: Find a coherent API to bind the global context on the observer
    if (!load) {
      return
    }

    EnvironmentObserver.environment.forEach((name: string) => {
      const variable = process.env[name]

      if (!variable) {
        throw new Error(`Required variable ${name} not found`)
      }

      configValues[name] = variable
    })
  }

  /**
   * This method will be invoked when the application starts.
   */
  async start(): Promise<void> {
    // Add your logic for start
  }

  /**
   * This method will be invoked when the application stops.
   */
  async stop(): Promise<void> {
    // Add your logic for stop
  }
}
