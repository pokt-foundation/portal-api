import { ApplicationConfig } from '@loopback/core'

import { PocketGatewayApplication } from './application'

const logger = require('./services/logger')

const DEFAULT_APPLICATION_OPTIONS = { env: { load: true } }

export { PocketGatewayApplication }

export async function main(options: ApplicationConfig = {}): Promise<PocketGatewayApplication> {
  options = DEFAULT_APPLICATION_OPTIONS

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
