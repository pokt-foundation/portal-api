import axios from 'axios'
import 'dotenv/config'
import { Count, DefaultCrudRepository, Entity } from '@loopback/repository'

import { Applications, LoadBalancers, PocketAccount } from '../models'
import { Cache } from '../services/cache'

const logger = require('./logger')

const FALLBACK_WARNING = 'Data from Pocket HTTP DB not fetched. Falling back to fetching from MongoDB.'
const FAILURE_ERROR = 'Data from Pocket HTTP DB not fetched. No fallback set so data fetch failed.'

type ModelRef = new (...args: any[]) => any //eslint-disable-line
interface ModelProps extends ModelRef {
  definition?: { properties: { [key: string]: { required?: boolean } } }
}

interface FindParams<T extends Entity> {
  path: string
  model: ModelRef
  fallback: DefaultCrudRepository<T, unknown>['find']
  cacheKey?: string
  cache?: Cache
}

interface FindOneParams<T extends Entity> {
  path: string
  id: string
  model: ModelRef
  fallback: DefaultCrudRepository<T, unknown>['findOne']
  cache?: Cache
}

interface CountParams<T extends Entity> {
  path: string
  model: ModelRef
  fallback: DefaultCrudRepository<T, unknown>['count']
}

interface PostgresGatewayAAT {
  address: string
  applicationPublicKey: string
  applicationSignature: string
  clientPublicKey: string
  privateKey: string
  version: string
}

/** The PHDClient fetches data from the Pocket HTTP DB, and falls back to fetching from the Loopback repositorites
 * (which connect to MongoDB) if the fetch fails or the returned data is missing required fields. */
class PHDClient {
  private apiKey: string
  private baseUrl: string

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl
    this.apiKey = apiKey
  }

  async find<T extends Entity>({
    path,
    model,
    cache,
    cacheKey = 'blockchains', // Currently .find only used to get blockchains
    fallback,
  }: FindParams<T>): Promise<T[]> {
    const url = `${this.baseUrl}/${path}`
    const modelFields = this.getRequiredModelFields(model)
    const modelsData: T[] = []

    try {
      const { data: documents } = await axios.get(url, { headers: { authorization: this.apiKey } })

      documents.forEach((document) => {
        if (this.hasAllRequiredModelFields<T>(document, modelFields)) {
          modelsData.push(new model(document))
        } else {
          throw new Error('data not instance of model')
        }
      })
    } catch (error) {
      if (fallback) {
        logger.log('warn', FALLBACK_WARNING, { error })

        const documents = await fallback()

        documents.forEach((document) => {
          modelsData.push(new model(document))
        })
      } else {
        logger.log('error', FAILURE_ERROR, { error })

        throw error
      }
    }

    if (cache && cacheKey) {
      await cache.set(cacheKey, JSON.stringify(modelsData), 'EX', 60)
    }

    return modelsData
  }

  async findById<T extends Entity>({ path, id, model, cache, fallback }: FindOneParams<T>): Promise<T> {
    const url = `${this.baseUrl}/${path}/${id}`
    const modelFields = this.getRequiredModelFields(model)
    let modelData: T

    try {
      const { data: document } = await axios.get(url, { headers: { authorization: this.apiKey } })

      const processMethod = {
        ['application']: () => this.processApplication(document),
        ['load_balancer']: () => this.processLoadBalancer(document),
      }[path]

      const processedDocument = processMethod?.() || document

      if (this.hasAllRequiredModelFields<T>(processedDocument, modelFields)) {
        modelData = new model(processedDocument)
      } else {
        throw new Error('data not instance of model')
      }
    } catch (error) {
      if (fallback) {
        logger.log('warn', FALLBACK_WARNING, { error })

        const document = await fallback()

        modelData = new model(document)
      } else {
        logger.log('error', FAILURE_ERROR, { error })
        throw error
      }
    }

    if (cache) {
      await cache.set(id, JSON.stringify(modelData), 'EX', 60)
    }

    return modelData
  }

  async count<T extends Entity>({ path, fallback }: CountParams<T>): Promise<Count> {
    const url = `${this.baseUrl}/${path}`

    try {
      const { data: documents } = await axios.get(url, { headers: { authorization: this.apiKey } })

      return { count: documents.length }
    } catch (error) {
      if (fallback) {
        logger.log('warn', FALLBACK_WARNING, { error })

        return fallback()
      } else {
        logger.log('error', FAILURE_ERROR, { error })
        throw error
      }
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
    document.applicationIDs = document.Applications.map(({ id: appID }) => appID)
    delete document.Applications

    return document
  }

  /** Gets a string array of all the fields marked as required by the Loopback model */
  private getRequiredModelFields(model: ModelProps): string[] {
    return Object.entries(model.definition.properties)
      .filter(([_, { required }]) => required)
      .map(([key]) => key)
  }

  /** Checks that the data returned from the PHD has all required fields used by the
      Portal API code, meaning all required fields declared by the Loopbak model. */
  private hasAllRequiredModelFields<T>(data: T, modelFields: string[]): boolean {
    return modelFields.every((key) => Object.keys(data).includes(key))
  }
}

export { PHDClient }
