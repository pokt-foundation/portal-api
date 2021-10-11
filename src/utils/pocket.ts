import { Configuration } from '@pokt-network/pocket-js'
import { Decryptor } from 'strong-cryptor'
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

  if (
    application.gatewaySettings.secretKeyRequired && // If the secret key is required by app's settings // and
    application.gatewaySettings.secretKey && // the app's secret key is set // and
    (!secretKeyDetails.secretKey || // the request doesn't contain a secret key // or
      secretKeyDetails.secretKey.length < 32 || // the secret key is invalid // or
      (secretKeyDetails.secretKey.length === 32 &&
        secretKeyDetails.secretKey !== application.gatewaySettings.secretKey) || // the secret key does not match plaintext // or
      (secretKeyDetails.secretKey.length > 32 &&
        secretKeyDetails.secretKey !== decryptor.decrypt(application.gatewaySettings.secretKey))) // does not match encrypted
  ) {
    return false
  }
  return true
}

export type SecretKeyDetails = {
  databaseEncryptionKey: string
  secretKey: string
}
