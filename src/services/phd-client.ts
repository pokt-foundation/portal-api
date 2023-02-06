import axios from 'axios'
import 'dotenv/config'
import { Count, Entity } from '@loopback/repository'

import { Applications, LoadBalancers, PocketAccount } from '../models'
import { Cache } from '../services/cache'

const logger = require('./logger')

const FAILURE_ERROR = 'Data fetching from Pocket HTTP DB failed'

type ModelRef = new (...args: any[]) => any //eslint-disable-line
interface ModelProps extends ModelRef {
  definition?: { properties: { [key: string]: { required?: boolean } } }
}

interface FindParams {
  path: string
  model: ModelRef
  cacheKey?: string
  cache?: Cache
}

interface FindOneParams {
  path: string
  id: string
  model: ModelRef
  cache?: Cache
}

interface CountParams {
  path: string
  model: ModelRef
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

/** The PHDClient fetches data from the Pocket HTTP DB, and falls back to fetching from the Loopback repositorites
 * (which connect to MongoDB) if the fetch fails or the returned data is missing required fields. */
class PHDClient {
  private apiKey: string
  private baseUrl: string

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl
    this.apiKey = apiKey
  }

  async find<T extends Entity>({ path, model, cache, cacheKey }: FindParams): Promise<T[]> {
    if (cache && !cacheKey) {
      throw new Error(`cacheKey not set for path ${path}`)
    }

    const url = `${this.baseUrl}/${path}`
    const modelFields = this.getRequiredModelFields(model)
    const modelsData: T[] = []

    try {
      const { data: documents } = await axios.get(url, { headers: { authorization: this.apiKey } })

      documents.forEach((document) => {
        if (this.hasAllRequiredModelFields(document, modelFields)) {
          modelsData.push(new model(document))
        } else {
          throw new Error('data not instance of model')
        }
      })
    } catch (error) {
      logger.log('error', FAILURE_ERROR, { error })
      throw error
    }

    if (cache && cacheKey) {
      await cache.set(cacheKey, JSON.stringify(modelsData), 'EX', 60)
    }

    return modelsData
  }

  async findById<T extends Entity>({ path, id, model, cache }: FindOneParams): Promise<T> {
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
      logger.log('error', FAILURE_ERROR, { error })
      throw error
    }

    if (cache) {
      await cache.set(id, JSON.stringify(modelData), 'EX', 60)
    }

    return modelData
  }

  async count({ path }: CountParams): Promise<Count> {
    const url = `${this.baseUrl}/${path}`

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
    document.applicationIDs = document.Applications.map(({ id: appID }) => appID)
    delete document.Applications

    if (document.userID && !document.user) {
      document.user = document.userID
      delete document.userID
    }

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
