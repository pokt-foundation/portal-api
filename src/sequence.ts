import { Redis } from 'ioredis'
import shortID from 'shortid'
import { inject } from '@loopback/context'
import {
  FindRoute,
  InvokeMethod,
  ParseParams,
  Reject,
  RequestContext,
  RestBindings,
  Send,
  SequenceHandler,
} from '@loopback/rest'
import { Configuration } from '@pokt-network/pocket-js'
import { getPocketInstance } from './config/pocket-config'
import { POCKET_JS_INSTANCE_TIMEOUT_KEY, POCKET_JS_TIMEOUT_MAX, POCKET_JS_TIMEOUT_MIN } from './utils/constants'
import { getRandomInt, shuffle } from './utils/helpers'
const logger = require('./services/logger')

const SequenceActions = RestBindings.SequenceActions

export class GatewaySequence implements SequenceHandler {
  constructor(
    @inject(SequenceActions.FIND_ROUTE) protected findRoute: FindRoute,
    @inject(SequenceActions.PARSE_PARAMS) protected parseParams: ParseParams,
    @inject(SequenceActions.INVOKE_METHOD) protected invoke: InvokeMethod,
    @inject(SequenceActions.SEND) public send: Send,
    @inject(SequenceActions.REJECT) public reject: Reject
  ) {}

  async handle(context: RequestContext): Promise<void> {
    try {
      const { request, response } = context
      const requestID = shortID.generate()

      // Record the host, user-agent, and origin for processing
      const realIP = request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'no-ip-found'

      context.bind('ipAddress').to(realIP)
      context.bind('headers').to(request.headers)
      context.bind('host').to(request.headers['host'])
      context.bind('userAgent').to(request.headers['user-agent'])
      context.bind('origin').to(request.headers['origin'])
      context.bind('contentType').to(request.headers['content-type'])
      context.bind('relayPath').to(request.headers['relay-path'])
      context.bind('httpMethod').to(request.method)

      let secretKey = ''

      // SecretKey passed in via basic http auth
      if (request.headers['authorization']) {
        const base64Credentials = request.headers['authorization'].split(' ')[1]
        const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii').split(':')

        if (credentials[1]) {
          secretKey = credentials[1]
        }
      }
      context.bind('secretKey').to(secretKey)

      // Unique ID for log tracing
      context.bind('requestID').to(requestID)

      // Custom routing for blockchain paths:
      // If it finds an extra path on the end of the request, slice off the path
      // and convert the slashes to tildes for processing in the v1.controller
      if (
        request.method === 'POST' &&
        // Matches either /v1/lb/LOADBALANCER_ID or /v1/APPLICATION_ID
        (request.url.match(/^\/v1\/lb\//) || request.url.match(/^\/v1\/[0-9a-zA-Z]{24}\//))
      ) {
        if (request.url.match(/^\/v1\/lb\//)) {
          request.url = `/v1/lb/${request.url.slice(7).replace(/\//gi, '~')}`
        } else if (request.url.match(/^\/v1\/[0-9a-z]{24}\//)) {
          request.url = `${request.url.slice(0, 28)}${request.url.slice(28).replace(/\//gi, '~')}`
        }
      }

      response.header('Access-Control-Allow-Origin', '*')
      response.header('Access-Control-Allow-Credentials', 'true')
      response.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE')
      response.header('Vary', 'Access-Control-Request-Headers')
      response.header('Access-Control-Allow-Headers', 'user-agent,origin,content-type')
      response.header('Access-Control-Max-Age', '86400')

      if (request.method === 'OPTIONS') {
        response.status(200)
        this.send(response, '')
      } else {
        const route = this.findRoute(request)
        const args = await this.parseParams(request, route)
        const result = await this.invoke(route, args)

        this.send(response, result)
      }
    } catch (err) {
      this.reject(context, err)
    }
  }

  async updatePocketInstance(context: RequestContext, requestID: string): Promise<void> {
    const redis: Redis = await context.get('redisInstance')
    const dispatchers: URL[] = shuffle(
      ((await context.get('dispatchURL')) as string).split(',').map((dist) => new URL(dist))
    )
    const configuration: Configuration = await context.get('pocketConfiguration')
    const clientPrivateKey: string = await context.get('clientPrivateKey')
    const clientPassphrase: string = await context.get('clientPassphrase')

    if (!(await redis.get(POCKET_JS_INSTANCE_TIMEOUT_KEY))) {
      const pocket = await getPocketInstance(dispatchers, configuration, clientPrivateKey, clientPassphrase)

      const nextInstanceRefresh = getRandomInt(POCKET_JS_TIMEOUT_MIN, POCKET_JS_TIMEOUT_MAX)

      await redis.set(POCKET_JS_INSTANCE_TIMEOUT_KEY, 'true', 'EX', nextInstanceRefresh)

      const ownerCtx = context.getOwnerContext('pocketInstance')

      ownerCtx.unbind('pocketInstance')
      ownerCtx.bind('pocketInstance').to(pocket)

      logger.log('info', `pocketjs instance updated`, {
        requestID,
        nextInstanceRefresh,
      })
    }
  }
}
