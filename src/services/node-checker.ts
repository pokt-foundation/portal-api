import get from 'lodash/get'
import { Pocket, Configuration, Node, RelayResponse, PocketAAT, HTTPMethod, RpcError } from '@pokt-network/pocket-js'
import { blockHexToDecimal } from '../utils/block'
import { checkEnforcementJSON } from '../utils/enforcements'

const CONSENSUS_NODE_COUNT = 5
const CONSENSUS_TIMEOUT = 2000
const CONSENSUS_ACCEPT_DISPUTED_RESPONSE = false

export type Check = 'sync-check' | 'chain-check' | 'archival-check'

export type NodeCheckResponse<T> = {
  node: Node
  check: Check
  success: boolean
  response: string | Error
  output?: T
}

export type ChainCheck = {
  chainID: number
}

export type SyncCheck = {
  blockHeight: number
}

export type ArchivalCheck = {
  message: string
}

type ProcessCheck = {
  success: boolean
  relayResponse: RelayResponse | Error
  output: string | number
}

export class NodeChecker {
  pocket: Pocket
  configuration: Configuration | undefined

  constructor(pocket: Pocket, configuration?: Configuration) {
    this.pocket = pocket
    this.configuration = configuration || pocket.configuration
  }

  /**
   * Returns a decimal representation from a block's hexadecimal response
   * @param payload object containing the hexadecimal value
   * @param key key for which the value is stored
   * @returns decimal representation of the object's response
   */
  static parseHexFromPayload(payload: object, key: string): number {
    const rawHeight = get(payload, key) || '0'

    return blockHexToDecimal(rawHeight)
  }

  /**
   * Perfoms chain check of a node, making sure the chain a node reports to support is the one that is being requested
   * within the session.
   * @param node Node to check.
   * @param data Payload to send to the blockchain, expected to return the blockchain's chainID.
   * @param blockchainID Blockchain to request data from.
   * @param aat Pocket Authentication Token object.
   * @param chainID  blockchain chain's ID to evaluate against.
   * @param path  optional. Blockchain's path to send the request to.
   * @returns Response object containing the relay response, request output and boolean
   * assuring whether the node supports the correct chain or not
   */
  async performChainCheck(
    node: Node,
    data: string,
    blockchainID: string,
    aat: PocketAAT,
    chainID: number,
    path?: string
  ): Promise<NodeCheckResponse<ChainCheck>> {
    let nodeChainID: number

    const isCorrectChain = function (payload: object, chainIDArg: number) {
      nodeChainID = NodeChecker.parseHexFromPayload(payload, 'result')
      return nodeChainID === chainIDArg
    }

    const { relayResponse, success } = await this.processCheck(
      node,
      data,
      blockchainID,
      aat,
      path,
      chainID,
      isCorrectChain
    )

    if (relayResponse instanceof Error) {
      return { node, check: 'chain-check', success: false, response: relayResponse, output: { chainID: 0 } }
    }

    return {
      node,
      check: 'chain-check',
      success,
      response: relayResponse.payload,
      output: { chainID: typeof nodeChainID === 'number' ? nodeChainID : 0 },
    }
  }

  /**
   * Performs sync check on a node, making sure the node's blockheight is enough to perfom optimal transactions.
   * A source blockheight is required to compare against, if no valid source is provided, will return true on any height
   * higher than 0.
   * @param node node to check.
   * @param data Payload to send to the blockchain, expected to return the blockchain's block height.
   * @param blockchainID Blockchain to request data from.
   * @param aat Pocket Authentication token object.
   * @param resultKey key field from the relay response that's expected to have the chain's blockheight.
   * @param path  optional. Blockchain's path to send the request to.
   * @param source optional but encouraged to be provided. Source to compare the node's blockheight against.
   * @param allowance optional. Allowed Threshold of number of blocks behind from the node.
   * @returns response object containing the relay response, request output and boolean
   * assuring whether the node is on sync with the source, or has a block height over 0 in case no source was provided.
   */
  async performSyncCheck(
    node: Node,
    data: string,
    blockchainID: string,
    aat: PocketAAT,
    resultKey: string,
    path?: string,
    source?: number,
    allowance = 0
  ): Promise<NodeCheckResponse<SyncCheck>> {
    let blockheight: number

    const isSynced = function (payload: object, minimumAllowedHeight) {
      blockheight = NodeChecker.parseHexFromPayload(payload, resultKey)

      if (source > 0 && allowance >= 0) {
        return blockheight >= minimumAllowedHeight
      }
      return blockheight > 0
    }

    const { relayResponse, success } = await this.processCheck(
      node,
      data,
      blockchainID,
      aat,
      path,
      source - allowance,
      isSynced
    )

    if (relayResponse instanceof Error) {
      return { node, check: 'sync-check', success: false, response: relayResponse, output: { blockHeight: 0 } }
    }

    return {
      node,
      check: 'sync-check',
      success,
      response: relayResponse.payload,
      output: { blockHeight: typeof blockheight === 'number' ? blockheight : 0 },
    }
  }

  /**
   * Perfoms archival check on a node. Making sure the node is capable of performing archival-specific relays in the chain.
   * @param node Node to check.
   * @param data Payload to send to the blockchain, expected to return a response that will fail on non-archive nodes.
   * @param blockchainID Blockchain to request data from.
   * @param aat Pocket Authentication token object.
   * @param resultKey key field from the relay response that's expected to have a value on failing non-archive nodes
   * @param comparator value to compare the resultKey against.
   * @param path optional. Blockchain's path to send the request to.
   * @param swap optional. Instead of returning success on archival nodes, return success on not archival nodes.
   * @returns Response object containing the relay response and boolean.
   * assuring whether the node supports supports archival or not.
   */
  async performArchivalCheck(
    node: Node,
    data: string,
    blockchainID: string,
    aat: PocketAAT,
    resultKey: string,
    comparator: string | number,
    path?: string,
    swap = false
  ): Promise<NodeCheckResponse<ArchivalCheck>> {
    let payloadResponse: object

    const isArchival = function (payload: object, comparatorVal: string) {
      payloadResponse = payload
      const result = NodeChecker.parseHexFromPayload(payload, resultKey).toString()

      return swap ? result !== comparatorVal.toString() : result === comparatorVal.toString()
    }

    const { success, relayResponse } = await this.processCheck(
      node,
      data,
      blockchainID,
      aat,
      path,
      comparator,
      isArchival
    )

    if (relayResponse instanceof Error) {
      return {
        node,
        check: 'archival-check',
        success: false,
        response: relayResponse,
        output: {
          message: '',
        },
      }
    }

    return {
      node,
      check: 'archival-check',
      success,
      response: relayResponse.payload,
      output: {
        message: JSON.stringify(payloadResponse),
      },
    }
  }

  /**
   * Helper function for requesting the blockchain data, asserting it's valid, and returning the result from a comparator function
   * over the obtained relay response.
   * @param node node to perfom the request.
   * @param data payload to send to the blockchain.
   * @param blockchainID Blockchain to request data from.
   * @param aat Pocket Authentication token object.
   * @param path Blockchain's path to send the request to.
   * @param comparator value to compare the extracted output from resultKey.
   * @param comparatorFn Function to compare the extracted values, expected a boolean response.
   * @returns relayResponse, boolean for comparator response and resultKey output
   */
  private async processCheck(
    node: Node,
    data: string,
    blockchainID: string,
    aat: PocketAAT,
    path: string | undefined,
    comparator: string | number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    comparatorFn: (value: any, comparator) => boolean
  ): Promise<ProcessCheck> {
    const relayResponse = await this.sendRelay(data, blockchainID, aat, node, path)

    if (relayResponse instanceof Error) {
      return { success: false, relayResponse, output: 0 }
    }

    let payload = JSON.parse(relayResponse.payload)

    if (Array.isArray(payload)) {
      payload = payload[0]
    }

    const successCheck = comparatorFn(payload, comparator)

    return { relayResponse, success: successCheck, output: payload }
  }

  /**
   * Performs a consensus relay on all nodes. Meant to be used to slash nodes that fail any of the checks
   * @param data payload to send to the blockchain.
   * @param blockchainID Blockchain to request data from.
   * @param aat Pocket Authentication token object.
   * @param path  optional. Blockchain's path to send the request to.
   * @returns relay response from the blockchain.
   */
  async sendConsensusRelay(
    data: string,
    blockchainID: string,
    aat: PocketAAT,
    path?: string
  ): Promise<RelayResponse | Error> {
    return this.sendRelay(
      data,
      blockchainID,
      aat,
      undefined,
      path,
      this.updateConfigurationConsensus(this.configuration),
      true
    )
  }

  /**
   * Helper function to send a relay.
   * @param data payload to send to the blockchain.
   * @param blockchainID Blockchain to request data from.
   * @param aat Pocket Authentication token object.
   * @param node optional. Node to check.
   * @param path optional. Blockchain's path to send the request to.
   * @param configuration optional. Pocket's configuration object
   * @param consensusEnabled optional. Enable consensus
   * @returns relay response.
   */
  private async sendRelay(
    data: string,
    blockchainID: string,
    aat: PocketAAT,
    node?: Node,
    path?: string,
    configuration?: Configuration,
    consensusEnabled?: boolean
  ): Promise<RelayResponse | Error> {
    const relayResponse = await this.pocket.sendRelay(
      data,
      blockchainID,
      aat,
      this.updateConfigurationTimeout(configuration || this.configuration),
      undefined,
      HTTPMethod.POST,
      path,
      consensusEnabled ? undefined : node,
      consensusEnabled,
      undefined
    )

    if (relayResponse instanceof Error) {
      return relayResponse
    } else if (relayResponse instanceof RelayResponse && !checkEnforcementJSON(relayResponse.payload)) {
      // Unhandled error
      return new RpcError('0', `Unhandled Error: ${relayResponse.payload}`, undefined, node?.publicKey)
    }

    return relayResponse as RelayResponse
  }

  /**
   * Update the configuration's objects consensus value.
   * @param pocketConfiguration Pocket's Configuration object.
   * @returns updated configuration object.
   */
  private updateConfigurationConsensus(pocketConfiguration: Configuration): Configuration {
    return new Configuration(
      pocketConfiguration.maxDispatchers,
      pocketConfiguration.maxSessions,
      CONSENSUS_NODE_COUNT,
      CONSENSUS_TIMEOUT,
      CONSENSUS_ACCEPT_DISPUTED_RESPONSE,
      pocketConfiguration.sessionBlockFrequency,
      pocketConfiguration.blockTime,
      pocketConfiguration.maxSessionRefreshRetries,
      pocketConfiguration.validateRelayResponses,
      pocketConfiguration.rejectSelfSignedCertificates
    )
  }

  /**
   * Update the configuration's objects timeout value.
   * @param pocketConfiguration Pocket's Configuration object.
   * @returns updated configuration object.
   */
  private updateConfigurationTimeout(pocketConfiguration: Configuration, timeout = 4000): Configuration {
    return new Configuration(
      pocketConfiguration.maxDispatchers,
      pocketConfiguration.maxSessions,
      pocketConfiguration.consensusNodeCount,
      timeout,
      pocketConfiguration.acceptDisputedResponses,
      pocketConfiguration.sessionBlockFrequency,
      pocketConfiguration.blockTime,
      pocketConfiguration.maxSessionRefreshRetries,
      pocketConfiguration.validateRelayResponses,
      pocketConfiguration.rejectSelfSignedCertificates
    )
  }
}