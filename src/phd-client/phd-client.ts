import axios from 'axios'
import 'dotenv/config'
import { Count, DefaultCrudRepository, Entity } from '@loopback/repository'

import { Cache } from '../services/cache'

type ModelRef = new (...args: any[]) => any //eslint-disable-line
interface ModelFields extends ModelRef {
  definition?: {
    properties: { [key: string]: { type: string; id?: boolean; generated?: boolean; required?: boolean } }
  }
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

// TODO - Unit tests for PHD Client - all cases and fallbacks

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
    cacheKey = 'blockchains',
    fallback,
  }: FindParams<T>): Promise<T[]> {
    const url = `${this.baseUrl}/${path}`
    const modelsData: T[] = []

    try {
      const { data: documents } = await axios.get(url, { headers: { authorization: this.apiKey } })
      // console.debug('find - PHD RESULT', model.name, documents, url)

      documents.forEach((document) => {
        if (this.hasAllPortalFields<T>(document, model)) {
          modelsData.push(new model(document))
        } else {
          throw new Error('data not instance of model')
        }
      })
    } catch (error) {
      if (fallback) {
        const documents = await fallback()
        // console.debug('find - FALLBACK RESULT', model.name, error.message, url)

        documents.forEach((document) => {
          modelsData.push(new model(document))
        })
      } else {
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
    let modelData: T

    try {
      const { data: document } = await axios.get(url, { headers: { authorization: this.apiKey } })

      // console.debug('find by ID - PHD RESULT', model.name, document, url)

      if (this.hasAllPortalFields<T>(document, model)) {
        modelData = new model(document)
      } else {
        throw new Error('data not instance of model')
      }
    } catch (error) {
      if (fallback) {
        const document = await fallback()
        // console.debug('find by ID - FALLBACK RESULT', model.name, error.message, url)

        modelData = new model(document)
      } else {
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
        return fallback()
      } else {
        throw error
      }
    }
  }

  /** Checks that the data returned from the PHD has all fields used by the
      Portal API code, meaning all fields declared by the Loopbak model. */
  private hasAllPortalFields<T>(data: T, model: ModelFields) {
    const modelFields = Object.entries(model.definition.properties)
      .filter(([_, { required }]) => required)
      .map(([key]) => key)
    const dataFields = Object.keys(data)
    const isInstanceOfModel = modelFields.every((key) => dataFields.includes(key))

    // TODO - Remove when tested. DEBUG ONLY
    if (!isInstanceOfModel) {
      // console.debug('DEBUG', model, {
      //   data,
      //   modelFields,
      //   dataFields,
      //   fieldsNotInLoopbackModel: dataFields.filter((key) => !modelFields.includes(key)),
      //   fieldsNotInPostgres: modelFields.filter((key) => !dataFields.includes(key)),
      // })
    }
    // DEBUG ONLY

    return isInstanceOfModel
  }
}

export { PHDClient }
