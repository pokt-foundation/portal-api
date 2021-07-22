import { PocketGatewayApplication } from './application'
import { ApplicationConfig } from '@loopback/core'

const logger = require('./services/logger')

const DEFAULT_APPLICATION_OPTIONS = { load: true }

export { PocketGatewayApplication }

export async function main(options: ApplicationConfig = {}): Promise<PocketGatewayApplication> {
  options.env = DEFAULT_APPLICATION_OPTIONS

  const app = new PocketGatewayApplication(options)

  app.on('stateChanged', (data) => {
    console.log('app state changed', data)
  })

  await app.boot()
  await app.start()
  await app.loadPocket()

  logger.log('info', `Server is running at ${app.restServer.url}`, {
    requestID: '',
    relayType: '',
    typeID: '',
    serviceNode: '',
  })
  return app
}
