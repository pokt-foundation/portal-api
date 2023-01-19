import { Decryptor } from 'strong-cryptor'
import { Applications } from '../models'
import { Cache } from '../services/cache'
import { getRateLimitedApps } from './cache'
import { isUserErrorEVM } from './errors'

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

// Returns whether an application should be rate limited
export async function shouldRateLimit(appID: string, rateLimiter: RateLimiter, cache: Cache): Promise<boolean> {
  if (appID.length === 0) {
    return false
  }

  const limitedApps = await getRateLimitedApps(cache.local, rateLimiter)
  if (limitedApps.length === 0) {
    return false
  }

  return limitedApps.includes(appID.toLowerCase())
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

export type RateLimiter = {
  URL: string
  token: string
}

export function isRelayError(payload: string): boolean {
  return payload.includes('{"error"')
}

export function isUserError(payload: string, blockchain?: string): boolean {
  // TODO: Non-evm errors
  return isUserErrorEVM(payload)
}
