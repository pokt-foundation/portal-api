import { Decryptor } from 'strong-cryptor'
import { Configuration } from '@pokt-network/pocket-js'
import { Applications } from '../models'

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

export function checkSecretKey(application: Applications, secretKeyDetails: SecretKeyDetails): boolean {
  // Check secretKey; is it required? does it pass? -- temp allowance for unencrypted keys
  const decryptor = new Decryptor({ key: secretKeyDetails.databaseEncryptionKey })

  const appHasSecretKey = application.gatewaySettings.secretKeyRequired && application.gatewaySettings.secretKey

  const isSecretKeyInvalid = !secretKeyDetails.secretKey || secretKeyDetails.secretKey.length < 32

  const secretKeyDoesntMatchPlainText =
    secretKeyDetails.secretKey.length === 32 && secretKeyDetails.secretKey !== application.gatewaySettings.secretKey

  const secretKeyDoesntMatchEncrypted =
    secretKeyDetails.secretKey.length > 32 &&
    secretKeyDetails.secretKey !== decryptor.decrypt(application.gatewaySettings.secretKey)

  if (appHasSecretKey && (isSecretKeyInvalid || secretKeyDoesntMatchPlainText || secretKeyDoesntMatchEncrypted)) {
    return false
  }
  return true
}

export type SecretKeyDetails = {
  databaseEncryptionKey: string
  secretKey: string
}
