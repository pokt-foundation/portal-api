import get from 'lodash/get'
import { Pocket, Configuration, Node, RelayResponse, PocketAAT, HTTPMethod, RpcError } from '@pokt-network/pocket-js'
import { blockHexToDecimal } from '../utils/block'
import { checkEnforcementJSON } from '../utils/enforcements'

export type Check = 'sync-check' | 'chain-check' | 'archival-check'

export type NodeCheckResponse<T> = {
  node: Node
  check: Check
  success: boolean
  response: string | Error
  result?: T
}

export type ChainCheck = {
  chainID: number
}

export type SyncCheck = {
  blockHeight: number
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
  static parseBlockFromPayload(payload: object, key: string): number {
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
  async chain(
    node: Node,
    data: string,
    blockchainID: string,
    aat: PocketAAT,
    chainID: number,
    path?: string
  ): Promise<NodeCheckResponse<ChainCheck>> {
    let nodeChainID: number

    const isCorrectChain = (payload: any, chainIDArg) => {
      nodeChainID = NodeChecker.parseBlockFromPayload(payload, 'result')
      return nodeChainID === chainIDArg
    }

    const { relayResponse, success } = await this.processCheck(
      node,
      data,
      blockchainID,
      aat,
      path,
      'result',
      chainID,
      isCorrectChain
    )

    if (relayResponse instanceof Error) {
      return { node, check: 'chain-check', success: false, response: relayResponse, result: { chainID: 0 } }
    }

    return {
      node,
      check: 'chain-check',
      success,
      response: relayResponse.payload,
      result: { chainID: typeof nodeChainID === 'number' ? nodeChainID : 0 },
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
  async sync(
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

    const isSynced = (payload: any, minimumAllowedHeight) => {
      blockheight = NodeChecker.parseBlockFromPayload(payload, resultKey)

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
      resultKey,
      source - allowance,
      isSynced
    )

    if (relayResponse instanceof Error) {
      return { node, check: 'sync-check', success: false, response: relayResponse, result: { blockHeight: 0 } }
    }

    return {
      node,
      check: 'sync-check',
      success,
      response: relayResponse.payload,
      result: { blockHeight: typeof blockheight === 'number' ? blockheight : 0 },
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
   * @returns Response object containing the relay response and boolean.
   * assuring whether the node supports supports archival or not.
   */
  async archival(
    node: Node,
    data: string,
    blockchainID: string,
    aat: PocketAAT,
    resultKey: string,
    comparator: string,
    path?: string
  ): Promise<NodeCheckResponse<void>> {
    const isArchival = (result: string | number, comparatorVal: string) => result.toString() !== comparatorVal

    const { success, relayResponse } = await this.processCheck(
      node,
      data,
      blockchainID,
      aat,
      path,
      resultKey,
      comparator,
      isArchival
    )

    if (relayResponse instanceof Error) {
      return { node, check: 'archival-check', success: false, response: relayResponse }
    }

    return { node, check: 'archival-check', success, response: relayResponse.payload }
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
   * Helper function for request the blockchains data, asserting is valid and return the result from a comparator function
   * over the obtained relay response.
   * @param node node to perfom the request.
   * @param data payload to send to the blockchain.
   * @param blockchainID Blockchain to request data from.
   * @param aat Pocket Authentication token object.
   * @param resultKey key to extract data from the JSON response, for nested keys can be added using dot notation
   * (i.e. 'example.nested').
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
    resultKey: string,
    comparator: string | number,
    comparatorFn: (value: any, comparator) => boolean
  ): Promise<ProcessCheck> {
    const relayResponse = await this.sendRelay(data, blockchainID, aat, node, path)

    if (relayResponse instanceof Error) {
      return { success: false, relayResponse, output: 0 }
    }

    const payload = JSON.parse(relayResponse.payload)
    // const result = NodeChecker.parseBlockFromPayload(payload, resultKey)

    const successCheck = comparatorFn(payload, comparator)

    return { relayResponse, success: successCheck, output: payload }
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
      consensusEnabled
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
      5,
      2000,
      false,
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
  private updateConfigurationTimeout(pocketConfiguration: Configuration): Configuration {
    return new Configuration(
      pocketConfiguration.maxDispatchers,
      pocketConfiguration.maxSessions,
      pocketConfiguration.consensusNodeCount,
      4000,
      pocketConfiguration.acceptDisputedResponses,
      pocketConfiguration.sessionBlockFrequency,
      pocketConfiguration.blockTime,
      pocketConfiguration.maxSessionRefreshRetries,
      pocketConfiguration.validateRelayResponses,
      pocketConfiguration.rejectSelfSignedCertificates
    )
  }
}
