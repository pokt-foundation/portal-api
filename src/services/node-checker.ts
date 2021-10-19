import get from 'lodash/get'
import { Pocket, Configuration, Node, RelayResponse, PocketAAT, HTTPMethod, RpcError } from '@pokt-network/pocket-js'
import { blockHexToDecimal } from '../utils/block'
import { checkEnforcementJSON } from '../utils/enforcements'

export type Check = 'session-check' | 'chain-check' | 'archival-check'

export type NodeCheckResponse<T> = {
  check: Check
  passed: boolean
  response: string | Error
  result?: T
}

export type ChainCheck = {
  chainID: number
}

export type SyncCheck = {
  blockHeight: number
}

type BasicRPCResponse = {
  jsonrpc: string
  id: number
  result: string
}

export class NodeChecker {
  pocket: Pocket
  configuration: Configuration | undefined

  constructor(pocket: Pocket, configuration?: Configuration) {
    this.pocket = pocket
    this.configuration = configuration || pocket.configuration
  }

  static parseBlockFromPayload(payload: object, syncCheckResultKey: string): number {
    const rawHeight = get(payload, syncCheckResultKey) || '0'

    return blockHexToDecimal(rawHeight)
  }

  async chain(
    node: Node,
    data: string,
    blockchainID: string,
    chainID: number,
    aat: PocketAAT
  ): Promise<NodeCheckResponse<ChainCheck>> {
    const relayResponse = await this.sendRelay(data, blockchainID, aat, node)

    if (relayResponse instanceof Error) {
      return { check: 'chain-check', passed: false, response: relayResponse, result: { chainID: 0 } }
    }

    const payload: BasicRPCResponse = JSON.parse(relayResponse.payload)
    const nodeChainID = blockHexToDecimal(payload.result)
    const isCorrectChain = nodeChainID === chainID

    return {
      check: 'chain-check',
      passed: isCorrectChain,
      response: relayResponse.payload,
      result: { chainID: blockHexToDecimal(payload.result) },
    }
  }

  async sync(
    node: Node,
    data: string,
    resultKey: string,
    blockchainID: string,
    aat: PocketAAT,
    path?: string,
    source?: number,
    allowance?: number
  ): Promise<NodeCheckResponse<SyncCheck>> {
    const relayResponse = await this.sendRelay(data, blockchainID, aat, node, path)

    if (relayResponse instanceof Error) {
      return { check: 'chain-check', passed: false, response: relayResponse, result: { blockHeight: 0 } }
    }

    const payload = JSON.parse(relayResponse.payload)
    const blockHeight = NodeChecker.parseBlockFromPayload(payload, resultKey)

    const isSynced = source > 0 && allowance >= 0 ? source - blockHeight <= allowance : blockHeight > 0

    return {
      check: 'session-check',
      passed: isSynced,
      response: relayResponse.payload,
      result: { blockHeight },
    }
  }

  async sendConsensusRelay(data: string, blockchainID: string, aat: PocketAAT): Promise<RelayResponse | Error> {
    return this.sendRelay(
      data,
      blockchainID,
      aat,
      undefined,
      undefined,
      this.updateConfigurationConsensus(this.configuration),
      true
    )
  }

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
