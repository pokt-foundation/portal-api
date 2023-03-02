import axios from 'axios'
import 'dotenv/config'
import { Count, Entity } from '@loopback/repository'

import { HttpErrors } from '@loopback/rest'
import { Applications, LoadBalancers, PocketAccount } from '../models'
import { Cache } from '../services/cache'

const logger = require('./logger')

const FAILURE_ERROR = 'Data fetching from Pocket HTTP DB failed'

interface FindParams {
  path: string
  cacheKey?: string
  cache?: Cache
}

interface FindOneParams {
  path: string
  id: string
  cache?: Cache
}

interface CountParams {
  path: string
}

interface PostgresGatewayAAT {
  address: string
  applicationPublicKey: string
  applicationSignature: string
  clientPublicKey: string
  privateKey: string
  version: string
}

export enum PHDPaths {
  Application = 'application',
  Blockchain = 'blockchain',
  LoadBalancer = 'load_balancer',
}

export enum PHDCacheKeys {
  Blockchain = 'blockchains',
}

/** The PHDClient fetches data from the Pocket HTTP DB. */
class PHDClient {
  private apiKey: string
  private baseUrl: string

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl
    this.apiKey = apiKey
  }

  async find<T extends Entity>({ path, cache, cacheKey }: FindParams): Promise<T[]> {
    if (cache && !cacheKey) {
      throw new Error(`cacheKey not set for path ${path}`)
    }

    const url = `${this.baseUrl}/v1/${path}`

    try {
      const { data: documents } = await axios.get<T[]>(url, { headers: { authorization: this.apiKey } })

      if (cache && cacheKey) {
        await cache.set(cacheKey, JSON.stringify(documents), 'EX', 60)
      }

      return documents
    } catch (error) {
      logger.log('error', FAILURE_ERROR, { error })
      throw newHttpError(error)
    }
  }

  async findById<T extends Entity>({ path, id, cache }: FindOneParams): Promise<T> {
    const url = `${this.baseUrl}/v1/${path}/${id}`

    try {
      const { data: document } = await axios.get(url, { headers: { authorization: this.apiKey } })

      const processMethod = {
        ['application']: () => this.processApplication(document),
        ['load_balancer']: () => this.processLoadBalancer(document),
      }[path]

      const processedDocument = processMethod?.() || document

      if (cache) {
        await cache.set(id, JSON.stringify(processedDocument), 'EX', 60)
      }

      return processedDocument
    } catch (error) {
      logger.log('error', FAILURE_ERROR, { error })
      throw newHttpError(error)
    }
  }

  async count({ path }: CountParams): Promise<Count> {
    const url = `${this.baseUrl}/v1/${path}`

    try {
      const { data: documents } = await axios.get(url, { headers: { authorization: this.apiKey } })

      return { count: documents.length }
    } catch (error) {
      logger.log('error', FAILURE_ERROR, { error })
      throw error
    }
  }

  // Necessary to recreate the `freeTierApplicationAccount` object from the data provided by PHD
  processApplication(document): Applications {
    const { address, applicationPublicKey: publicKey, privateKey }: PostgresGatewayAAT = document.gatewayAAT

    const freeTierApplicationAccount: PocketAccount = {
      address,
      publicKey,
      privateKey,
    }

    document.freeTierApplicationAccount = freeTierApplicationAccount

    return document
  }

  // Necessary to recreate the `applicationIDs` array from the data provided by PHD
  processLoadBalancer(document): LoadBalancers {
    document.applicationIDs = document.applications.map(({ id: appID }) => appID)
    delete document.applications

    if (document.userID && !document.user) {
      document.user = document.userID
      delete document.userID
    }

    return document
  }
}

function newHttpError(error): HttpErrors.HttpError {
  if (!axios.isAxiosError(error)) {
    return new HttpErrors.InternalServerError(error.message)
  }
  return new HttpErrors[error.response.status](error.message)
}

export { PHDClient }
