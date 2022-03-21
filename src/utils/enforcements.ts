import { Decryptor } from 'strong-cryptor'
import { Applications } from '../models'
import { isEVMError } from './errors'

export function checkEnforcementJSON(test: string): boolean {
  if (!test || test.length === 0) {
    return false
  }
  // Code from: https://github.com/prototypejs/prototype/blob/560bb59414fc9343ce85429b91b1e1b82fdc6812/src/prototype/lang/string.js#L699
  // Prototype lib
  if (/^\s*$/.test(test)) {
    return false
  }
  test = test.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '@')
  test = test.replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']')
  test = test.replace(/(?:^|:|,)(?:\s*\[)+/g, '')
  return /^[\],:{}\s]*$/.test(test)
}

// Check passed in string against an array of whitelisted items
// Type can be "explicit" or substring match
export function checkWhitelist(tests: string[], check: string, type: string): boolean {
  if (!tests || tests.length === 0) {
    return true
  }
  if (!check) {
    return false
  }

  for (const test of tests) {
    if (type === 'explicit') {
      if (test.toLowerCase() === check.toLowerCase()) {
        return true
      }
    } else {
      if (check.toLowerCase().includes(test.toLowerCase())) {
        return true
      }
    }
  }
  return false
}

export function checkSecretKey(application: Applications, secretKeyDetails: SecretKeyDetails): boolean {
  const appHasSecretKey = application.gatewaySettings.secretKeyRequired && application.gatewaySettings.secretKey

  if (!appHasSecretKey) {
    return true
  }

  // Check secretKey; is it required? does it pass? -- temp allowance for unencrypted keys
  const decryptor = new Decryptor({ key: secretKeyDetails.databaseEncryptionKey })

  const isSecretKeyInvalid = !secretKeyDetails.secretKey || secretKeyDetails.secretKey.length < 32

  const secretKeyDoesntMatchPlainText =
    secretKeyDetails.secretKey.length === 32 && secretKeyDetails.secretKey !== application.gatewaySettings.secretKey

  const secretKeyDoesntMatchEncrypted =
    secretKeyDetails.secretKey.length > 32 &&
    secretKeyDetails.secretKey !== decryptor.decrypt(application.gatewaySettings.secretKey)

  return !(isSecretKeyInvalid || secretKeyDoesntMatchPlainText || secretKeyDoesntMatchEncrypted)
}

export type SecretKeyDetails = {
  databaseEncryptionKey: string
  secretKey: string
}

export function isRelayError(payload: string): boolean {
  return payload.includes('{"error"')
}

export function isUserError(payload: string, blockchain?: string): boolean {
  // TODO: Non-evm errors
  return isEVMError(payload)
}
