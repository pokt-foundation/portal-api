import {
  inject,
  /* inject, Application, CoreBindings, */
  lifeCycleObserver, // The decorator
  LifeCycleObserver, // The interface
} from '@loopback/core'

const ENV = process.env['NODE_ENV']

/**
 * This class will be bound to the application as a `LifeCycleObserver` during
 * `boot`
 */
@lifeCycleObserver('configuration')
export class EnvironmentObserver implements LifeCycleObserver {
  private static requiredEnvVars: string[] = [
    'NODE_ENV',
    'GATEWAY_CLIENT_PRIVATE_KEY',
    'GATEWAY_CLIENT_PASSPHRASE',
    'MONGO_ENDPOINT',
    'DATABASE_ENCRYPTION_KEY',
    'REDIS_PORT',
    'REMOTE_REDIS_ENDPOINT',
    'LOCAL_REDIS_ENDPOINT',
    'PSQL_CONNECTION',
    'PSQL_CERTIFICATE',
    'DISPATCH_URL',
    'POCKET_RELAY_RETRIES',
    'DEFAULT_SYNC_ALLOWANCE',
    'DEFAULT_LOG_LIMIT_BLOCKS',
    'AAT_PLAN',
    'INFLUX_URLS',
    'INFLUX_TOKENS',
    'INFLUX_ORGS',
    'ARCHIVAL_CHAINS',
    'BLOCKED_ADDRESSES_URL',
    'PHD_BASE_URL',
    'PHD_API_KEY',
    // Not required in code, but must be present in .env
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'GATEWAY_HOST',
  ]

  private static requiredEnvVarsOnlyInProd = []

  private static optionalEnvVars: string[] = [
    'ALWAYS_REDIRECT_TO_ALTRUISTS',
    'ALTRUIST_ONLY_CHAINS',
    'REDIS_LOCAL_TTL_FACTOR',
    'RATE_LIMITER_URL',
    'RATE_LIMITER_TOKEN',
    'INFLUX_BUCKET_NAME',
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

    const environmentVariables = EnvironmentObserver.requiredEnvVars.concat(
      EnvironmentObserver.optionalEnvVars,
      EnvironmentObserver.requiredEnvVarsOnlyInProd
    )

    environmentVariables.forEach((name: string) => {
      const variable = process.env[name]

      if (!variable && EnvironmentObserver.optionalEnvVars.indexOf(name) < 0) {
        if (ENV !== 'production' && EnvironmentObserver.requiredEnvVarsOnlyInProd.indexOf(name) >= 0) {
          return
        }
        throw new Error(`${name} required in ENV`)
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
