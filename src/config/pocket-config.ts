import { JsonRpcProvider } from '@pokt-foundation/pocketjs-provider'
import { Relayer } from '@pokt-foundation/pocketjs-relayer'
import { KeyManager } from '@pokt-foundation/pocketjs-signer'
import { HttpErrors } from '@loopback/rest'
const logger = require('../services/logger')

const IMPORT_ERROR_MESSAGE = 'Unable to import account'

export async function getPocketInstance(dispatchers: string[], privateKey: string): Promise<Relayer> {
  const provider = new JsonRpcProvider({
    rpcUrl: dispatchers[0].toString(),
    dispatchers,
  })

  let signer: KeyManager

  // Unlock primary client account for relay signing
  try {
    signer = await KeyManager.fromPrivateKey(privateKey)
  } catch (error) {
    logger.log('error', IMPORT_ERROR_MESSAGE, { error })
    throw new HttpErrors.InternalServerError(IMPORT_ERROR_MESSAGE)
  }

  return new Relayer({
    dispatchers,
    keyManager: signer,
    provider,
  })
}
