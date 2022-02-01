import axios, { AxiosResponse } from 'axios'
import { Node, Session, SessionHeader } from '@pokt-network/pocket-js'
import { getRandomInt } from '../utils/helpers'
import { DispatchNewSessionRequest, NodeAxiosResponse } from '../utils/types'

const logger = require('../services/logger')

export class PocketRPC {
  dispatchers: URL[]

  constructor(dispatchers: string) {
    this.dispatchers = dispatchers.split(',').map((distpatcher) => new URL(distpatcher))
  }

  async dispatchNewSession({
    appPublicKey,
    blockchainID,
    sessionHeight = 0,
    applicationID,
    origin,
    requestID,
    retries = 3,
  }: {
    appPublicKey: string
    blockchainID: string
    sessionHeight?: number
    applicationID?: string
    origin?: string
    requestID?: string
    retries?: number
  }): Promise<Session> {
    let dispatcher: URL
    let dispatchResponse: AxiosResponse

    for (let attempts = 0; attempts < retries; attempts++) {
      // Pocketjs session calls are more prone to timeouts when getting the dispatchers,
      // Doing the rpc call directly minimizes the possibily of failing due to timeouts
      dispatcher = this.pickRandomDispatcher()
      const dispatchURL = `${dispatcher}v1/client/dispatch`

      logger.log('info', 'Dispatcher information', {
        dispatcherList: this.dispatchers.map((dist) => dist.toString()),
        dispatchURL: dispatchURL,
        requestID,
        applicationID,
      })

      try {
        dispatchResponse = await axios.post(
          dispatchURL,
          {
            app_public_key: appPublicKey,
            chain: blockchainID,
            session_height: sessionHeight,
          } as DispatchNewSessionRequest,
          { timeout: 2000 }
        )
      } catch (e) {
        logger.log('error', `ERROR obtaining a session`, {
          relayType: 'APP',
          typeID: applicationID,
          origin,
          blockchainID,
          requestID,
          error: e,
        })
        continue
      }

      if (dispatchResponse.status !== 200) {
        logger.log('error', `Got a non 200 response on dispatcher request: ${dispatchResponse.data}`, {
          relayType: 'APP',
          typeID: applicationID,
          origin,
          blockchainID,
          requestID,
        })
        continue
      }

      const sessionHeader = new SessionHeader(appPublicKey, blockchainID, BigInt(0))

      // Converts the rpc response in a way that is compatible with pocketjs for
      // sending relays through
      const nodes: Node[] = (dispatchResponse.data.session.nodes as NodeAxiosResponse[]).map(PocketRPC.formatNode)

      return new Session(sessionHeader, dispatchResponse.data.session.key, nodes)
    }

    throw new Error(`Error obtaining a session: ${dispatchResponse.data}`)
  }

  pickRandomDispatcher(): URL {
    return this.dispatchers[getRandomInt(0, this.dispatchers.length)]
  }

  static formatNode(rawNode: NodeAxiosResponse): Node {
    return new Node(
      rawNode.address,
      rawNode.public_key,
      rawNode.jailed,
      rawNode.status,
      BigInt(rawNode.tokens),
      rawNode.service_url,
      rawNode.chains,
      rawNode.unstakingTime
    )
  }
}
