import { Configuration } from '@pokt-network/pocket-js'

export function updateConfiguration(pocketConfiguration: Configuration, requestTimeOut: number): Configuration {
  return new Configuration(
    pocketConfiguration.maxDispatchers,
    pocketConfiguration.maxSessions,
    pocketConfiguration.consensusNodeCount,
    requestTimeOut,
    pocketConfiguration.acceptDisputedResponses,
    pocketConfiguration.sessionBlockFrequency,
    pocketConfiguration.blockTime,
    pocketConfiguration.maxSessionRefreshRetries,
    pocketConfiguration.validateRelayResponses,
    pocketConfiguration.rejectSelfSignedCertificates,
    pocketConfiguration.useLegacyTxCodec
  )
}
