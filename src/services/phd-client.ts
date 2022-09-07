import axios from 'axios'
import 'dotenv/config'
import { Count, DefaultCrudRepository, Entity } from '@loopback/repository'

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

/** The PHDClient fetches data from the Pocket HTTP DB, and falls back to fetching from the Loopback repositorites
 * (which connect to MongoDB) if the fetch fails or the returned data is missing required fields. */
class PHDClient {
  private apiKey: string
  private baseUrl: string

  constructor() {
    this.apiKey = process.env.PHD_API_KEY
    this.baseUrl = process.env.PHD_BASE_URL
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

      if (this.hasAllRequiredModelFields<T>(document, modelFields)) {
        modelData = new model(document)
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
