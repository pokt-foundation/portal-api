/* eslint-disable import/order */
import jsonrpc, { ErrorObject, IParsedObject } from 'jsonrpc-lite'
import { RelayError } from '../../errors/types'
import { Applications } from '../../models'
import { MetricsRecorder } from '../../services/metrics-recorder'
import { NodeSticker } from '../../services/node-sticker'
import { MetricOptions } from '../../services/pocket-relayer'
import { isUserError } from '../enforcements'
import { enforceEVMRestrictions } from '../evm/restrictions'
import { RelayResponse } from '../types'
import { parseJSONRPCError, parseRPCID } from './parsing'

const logger = require('../../services/logger')

export async function enforceJSONRPCRestrictions({
  parsedRawData,
  application,
  requestID,
  logLimitBlocks,
  blockchainID,
  altruistURL,
  origin,
}) {
  // This converts the raw data into formatted JSON then back to a string for relaying.
  // This allows us to take in both [{},{}] arrays of JSON and plain JSON and removes
  // extraneous characters like newlines and tabs from the rawData.
  // Normally the arrays of JSON do not pass the AJV validation used by Loopback.
  const rpcID = parseRPCID(parsedRawData)

  return enforceRestrictions(application, parsedRawData, blockchainID, requestID, rpcID, logLimitBlocks, altruistURL)
}

export async function validateJSONRPCRelayResponse(
  relay: RelayResponse | Error,
  nodeSticker: NodeSticker,
  metricsRecorder: MetricsRecorder,
  metricOptions: MetricOptions
) {
  const {
    data,
    requestID,
    blockchainID,
    applicationID,
    gigastakeAppID,
    relayStart,
    applicationPublicKey,
    preferredNodeAddress,
    method,
    origin,
    session,
  } = metricOptions

  if (!(relay instanceof Error)) {
    // Even if the relay is successful, we could get an invalid response from servide node.
    // We attempt to parse the service node response using jsonrpc-lite lib.

    const parsedRelayResponse = jsonrpc.parse(relay.response as string) as IParsedObject

    // If the parsing goes wrong, we get a response with 'invalid' type and the following message.
    // We could get 'invalid' and not a parse error, hence we check both.
    if (parsedRelayResponse.type === 'invalid' && parsedRelayResponse.payload.message === 'Parse error') {
      throw new Error('Service Node returned an invalid response')
    }
    // Check for user error to bubble these up to the API
    let userErrorMessage = ''
    let userErrorCode = ''

    if (isUserError(relay.response)) {
      const userError = parseJSONRPCError(relay.response)

      userErrorMessage = userError.message
      userErrorCode = userError.code !== 0 ? String(userError.code) : ''
    }

    // Record success metric
    metricsRecorder
      .recordMetric({
        requestID,
        applicationID,
        applicationPublicKey,
        blockchainID,
        serviceNode: relay.serviceNode.publicKey,
        relayStart,
        result: 200,
        bytes: Buffer.byteLength(relay.response, 'utf8'),
        fallback: false,
        method,
        error: userErrorMessage,
        code: userErrorCode,
        origin,
        data,
        session,
        sticky: await NodeSticker.stickyRelayResult(preferredNodeAddress, relay.serviceNode.publicKey),
        gigastakeAppID,
      })
      .catch(function log(e) {
        logger.log('error', 'Error recording metrics: ' + e, {
          requestID,
          relayType: 'APP',
          typeID: applicationID,
          serviceNode: relay.serviceNode.publicKey,
        })
      })

    // If return payload is valid JSON, turn it into an object so it is sent with content-type: json
    return JSON.parse(relay.response)
  } else if (relay instanceof RelayError) {
    let error = relay.message

    if (typeof relay.message === 'object') {
      error = JSON.stringify(relay.message)
    }

    // If sticky and is over error threshold, remove stickiness
    const sticky = await NodeSticker.stickyRelayResult(preferredNodeAddress, relay.servicer_node)

    if (sticky === 'SUCCESS') {
      const errorCount = await nodeSticker.increaseErrorCount()

      if (errorCount > 5) {
        await nodeSticker.remove('error limit exceeded')
      }
    }

    metricsRecorder
      .recordMetric({
        requestID,
        applicationID,
        applicationPublicKey,
        blockchainID,
        serviceNode: relay.servicer_node,
        relayStart,
        result: 500,
        bytes: Buffer.byteLength(relay.message, 'utf8'),
        fallback: false,
        method,
        error,
        code: String(relay.code),
        origin,
        data,
        session,
        sticky,
        gigastakeAppID,
      })
      .catch(function log(e) {
        logger.log('error', 'Error recording metrics: ' + e, {
          requestID,
          relayType: 'APP',
          typeID: applicationID,
          serviceNode: relay.servicer_node,
        })
      })

    return relay
  }
}

async function enforceRestrictions(
  application: Applications,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsedRawData: Record<string, any>,
  blockchainID: string,
  requestID: string,
  rpcID: number,
  logLimitBlocks: number,
  altruist: string
): Promise<void | ErrorObject> {
  let response: Promise<void | ErrorObject>

  // Is it a bundled transaction?
  if (parsedRawData instanceof Array) {
    for (const rawData of parsedRawData) {
      response = enforceEVMRestrictions(application, rawData, blockchainID, requestID, rpcID, logLimitBlocks, altruist)

      // If any of the bundled tx triggers a restriction, return
      if (response instanceof ErrorObject) {
        return response
      }
    }
  } else {
    // Non-bundled tx
    response = enforceEVMRestrictions(
      application,
      parsedRawData,
      blockchainID,
      requestID,
      rpcID,
      logLimitBlocks,
      altruist
    )
  }

  // TODO: Non-EVM restrictions

  return response
}
