import { Request, RestBindings, get, ResponseObject } from '@loopback/rest'
import { inject } from '@loopback/context'

/**
 * OpenAPI response for ping()
 */
const PING_RESPONSE: ResponseObject = {
  description: 'Ping Response',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        title: 'PingResponse',
        properties: {
          greeting: { type: 'string' },
          date: { type: 'string' },
          url: { type: 'string' },
          headers: {
            type: 'object',
            properties: {
              'Content-Type': { type: 'string' },
            },
            additionalProperties: true,
          },
        },
      },
    },
  },
}

/**
 * OpenAPI response for version()
 */
const VERSION_RESPONSE: ResponseObject = {
  description: 'Version response',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          commit: { type: 'string' },
        },
      },
    },
  },
}

/**
 * A simple controller to bounce back http requests and provide version info
 */
export class PingController {
  constructor(@inject(RestBindings.Http.REQUEST) private req: Request) {}

  // Map to `GET /ping`
  @get('/ping', {
    responses: {
      '200': PING_RESPONSE,
    },
  })
  ping(): object {
    // Reply with a greeting, the current time, the url, and request headers
    return {
      greeting: 'Pocket Network Gateway is saying hello and welcome onboard!',
      date: new Date(),
      url: this.req.url,
      headers: Object.assign({}, this.req.headers),
    }
  }

  @get('/', {
    responses: {
      '200': PING_RESPONSE,
    },
  })
  index(): object {
    // Reply with a greeting, the current time, the url, and request headers
    return {
      greeting: 'Pocket Network Gateway is saying hello and welcome onboard!',
      date: new Date(),
      url: this.req.url,
      headers: Object.assign({}, this.req.headers),
    }
  }

  @get('/version', {
    responses: {
      '200': VERSION_RESPONSE,
    },
  })
  version(): object {
    // Reply with the current project's commit
    return { commit: process.env.COMMIT_HASH }
  }
}
