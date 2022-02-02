import { HttpErrors } from '@loopback/rest'
import { Account, Configuration, HttpRpcProvider, Pocket } from '@pokt-network/pocket-js'

const logger = require('../services/logger')

export type PocketConfiguration = {
  maxDispatchers?: number
  maxSessions?: number
  consensusNodeCount?: number
  requestTimeout?: number
  acceptDisputedResponses?: boolean
  sessionBlockFrequency?: number
  blockTime?: number
  maxSessionRefreshRetries?: number
  validateRelayResponses?: boolean
  rejectSelfSignedCertificates?: boolean
  useLegacyTxCodec?: boolean
}

export const DEFAULT_POCKET_CONFIG = {
  maxDispatchers: 44,
  maxSessions: 100000,
  consensusNodeCount: 5,
  requestTimeout: 120000, // 3 minutes
  acceptDisputedResponses: false,
  sessionBlockFrequency: 4,
  blockTime: 1038000,
  maxSessionRefreshRetries: 10200,
  validateRelayResponses: undefined,
  rejectSelfSignedCertificates: undefined,
  useLegacyTxCodec: true,
}

export const getPocketConfigOrDefault = (params?: PocketConfiguration): Configuration => {
  // Allows for proper object destructuring on default values
  if (!params) {
    params = {}
  }

  const {
    maxDispatchers = DEFAULT_POCKET_CONFIG.maxDispatchers,
    maxSessions = DEFAULT_POCKET_CONFIG.maxSessions,
    consensusNodeCount = DEFAULT_POCKET_CONFIG.consensusNodeCount,
    requestTimeout = DEFAULT_POCKET_CONFIG.requestTimeout,
    acceptDisputedResponses = DEFAULT_POCKET_CONFIG.acceptDisputedResponses,
    sessionBlockFrequency = DEFAULT_POCKET_CONFIG.sessionBlockFrequency,
    blockTime = DEFAULT_POCKET_CONFIG.blockTime,
    maxSessionRefreshRetries = DEFAULT_POCKET_CONFIG.maxSessionRefreshRetries,
    validateRelayResponses = DEFAULT_POCKET_CONFIG.validateRelayResponses,
    rejectSelfSignedCertificates = DEFAULT_POCKET_CONFIG.rejectSelfSignedCertificates,
    useLegacyTxCodec = DEFAULT_POCKET_CONFIG.useLegacyTxCodec,
  } = params

  return new Configuration(
    maxDispatchers,
    maxSessions,
    consensusNodeCount,
    requestTimeout,
    acceptDisputedResponses,
    sessionBlockFrequency,
    blockTime,
    maxSessionRefreshRetries,
    validateRelayResponses,
    rejectSelfSignedCertificates,
    useLegacyTxCodec
  )
}

export async function getPocketInstance(
  dispatchers: URL[],
  configuration: Configuration,
  clientPrivateKey: string,
  clientPassphrase: string
): Promise<Pocket> {
  const pocket = new Pocket(dispatchers, new HttpRpcProvider(dispatchers[0]), configuration)

  // Unlock primary client account for relay signing
  try {
    const importAccount = await pocket.keybase.importAccount(Buffer.from(clientPrivateKey, 'hex'), clientPassphrase)

    if (importAccount instanceof Account) {
      await pocket.keybase.unlockAccount(importAccount.addressHex, clientPassphrase, 0)
    }
  } catch (e) {
    logger.log('error', e)
    throw new HttpErrors.InternalServerError('Unable to import or unlock base client account')
  }

  return pocket
}
