import { RelayError } from '../../errors/types'
import { MetricsRecorder } from '../../services/metrics-recorder'
import { NodeSticker } from '../../services/node-sticker'
import { MetricOptions } from '../../services/pocket-relayer'
import { RelayResponse } from '../types'

const logger = require('../../services/logger')

export async function handleRESTRelayResponse(
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

  // TODO: Blockchain restrictions.
  if (!(relay instanceof Error)) {
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
        error: '',
        code: '',
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
