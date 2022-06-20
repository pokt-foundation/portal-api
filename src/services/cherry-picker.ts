import { Node, Session } from '@pokt-foundation/pocketjs-types'
import { Redis } from 'ioredis'
import { Applications } from '../models'
import { removeNodeFromSession } from '../utils/cache'
import { Cache } from './cache'

const logger = require('../services/logger')

const logStats = (process.env['LOG_CHERRY_PICKER_STATS'] || '').toLowerCase() === 'true'

//  of  a   to 
// being   the 
const TIMEOUT_LIMIT = 20

// Allowed difference on , expressed in seconds, as the timeout usually
// wont be exact
const TIMEOUT_VARIANCE = 2

// The maximum median latency for a node to be considered as providing optimal service.
// This is temporarily a constant for MVP and will be moved to the database to be
// variable per chain. Measured in seconds.
const EXPECTED_SUCCESS_LATENCY = 0.15

// This multiplier is tested to produce a curve that adequately punishes slow nodes
const WEIGHT_MULTIPLIER = 35

export class CherryPicker {
  checkDebug: boolean
  redis: Redis
  archivalChains: string[]

  constructor({ redis, checkDebug, archivalChains }: { redis: Redis; checkDebug: boolean; archivalChains?: string[] }) {
    this.redis = redis
    this.checkDebug = checkDebug
    this.archivalChains = archivalChains || []
  }

  // Record the latency and success rate of each node, 1 hor TTL
  // When selecting a node, pull the stats for each node in the session
  // Rank and weight them for node choice.
  async cherryPickNode(
    application: Applications,
    nodes: Node[],
    blockchain: string,
    requestID: string,
    sessionKey: string
  ): Promise<Node> {
    const rawNodes = {} as { [nodePublicKey: string]: Node }
    const rawNodeIDs = [] as string[]
    let sortedLogs = [] as ServiceLog[]

    for (const node of nodes) {
      rawNodes[node.publicKey] = node
      rawNodeIDs.push(node.publicKey)
    }

    // Pull all service & failure & error logs
    const { rawServiceLogs, rawFailureLogs, rawErrorLogs } = await this.fetchRawLogs(blockchain, rawNodeIDs)

    for (const node of nodes) {
      sortedLogs.push(
        await this.createUnsortedLog(
          node.publicKey,
          blockchain,
          rawServiceLogs[node.publicKey]!,
          rawFailureLogs[node.publicKey]!,
          rawErrorLogs[node.publicKey]!
        )
      )
    }

    // Sort node logs by highest success rate, then by lowest latency
    sortedLogs = this.sortLogs(sortedLogs)

    if (logStats) {
      logger.log('info', 'CHERRY PICKER STATS Sorted logs: ' + JSON.stringify(sortedLogs), {
        requestID: requestID,
        blockchainID: blockchain,
        sessionKey: sessionKey,
      })
    }

    // Iterate through sorted logs and form in to a weighted list
    let rankedItems = await this.rankItems(blockchain, sortedLogs, 50)

    // If we have no nodes left it's because all are failures, ¯\_(ツ)_/¯
    if (rankedItems.length === 0) {
      logger.log('warn', 'Cherry picking failure -- nodes', {
        requestID: requestID,
        relayType: 'APP',
        typeID: application.id,
        serviceNode: '',
        blockchainID: blockchain,
      })
      rankedItems = rawNodeIDs
    }

    const selectedNode = Math.floor(Math.random() * rankedItems.length)
    const node = rawNodes[rankedItems[selectedNode]]

    if (this.checkDebug) {
      logger.log('info', 'CHERRY PICKER STATS Number of weighted nodes for selection: ' + rankedItems.length, {
        requestID: requestID,
        relayType: 'APP',
        typeID: application.id,
        serviceNode: '',
        blockchainID: blockchain,
      })
      logger.log('info', 'CHERRY PICKER STATS Selected ' + selectedNode + ' : ' + node.publicKey, {
        requestID: requestID,
        relayType: 'APP',
        typeID: application.id,
        serviceNode: '',
        blockchainID: blockchain,
      })
    }
    return node
  }

  // Fetch app/node's service or failure logs from redis
  async fetchRawLogs(blockchain: string, rawNodeIDs: string[]): Promise<{ [type: string]: { [id: string]: string } }> {
    const rawServiceLogs: { [id: string]: string } = {}
    const rawFailureLogs: { [id: string]: string } = {}
    const rawErrorLogs: { [id: string]: string } = {}

    const redisServiceKeys = rawNodeIDs.map(function (rawNodeID) {
      return `{${blockchain}}-${rawNodeID}-service`
    })
    const redisFailureKeys = rawNodeIDs.map(function (rawNodeID) {
      return `{${blockchain}}-${rawNodeID}-failure`
    })
    const redisErrorKeys = rawNodeIDs.map(function (rawNodeID) {
      return `{${blockchain}}-${rawNodeID}-errors`
    })

    const redisKeys = redisServiceKeys.concat(redisFailureKeys).concat(redisErrorKeys)
    const rawRedisLogs = await this.redis.mget(redisKeys)

    let logCount = 0
    rawNodeIDs.forEach((rawNodeID) => {
      rawServiceLogs[rawNodeID] = rawRedisLogs[logCount]
      logCount++
    })
    rawNodeIDs.forEach((rawNodeID) => {
      rawFailureLogs[rawNodeID] = rawRedisLogs[logCount]
      logCount++
    })
    rawNodeIDs.forEach((rawNodeID) => {
      rawErrorLogs[rawNodeID] = rawRedisLogs[logCount]
      logCount++
    })
    return { rawServiceLogs: rawServiceLogs, rawFailureLogs: rawFailureLogs, rawErrorLogs: rawErrorLogs }
  }

  // Fetch app/node's service log from redis
  async fetchRawServiceLog(blockchain: string, id: string | undefined): Promise<string | null> {
    const rawServiceLog = await this.redis.get(`{${blockchain}}-${id}-service`)

    return rawServiceLog
  }

  // Fetch app/node's overall failure true/false log from redis
  async fetchRawFailureLog(blockchain: string, id: string | undefined): Promise<string | null> {
    const rawFailureLog = await this.redis.get(`{${blockchain}}-${id}-failure`)

    return rawFailureLog
  }

  // Record app & node service quality in redis for future selection weight
  // { id: { results: { 200: x, 500: y, ... }, weightedSuccessLatency: z }
  async updateServiceQuality(
    blockchain: string,
    serviceNode: string,
    elapsedTime: number,
    result: number,
    session: Session,
    timeout?: number
  ): Promise<void> {
    // Removed while load balancer cherry picking is off
    await this._updateServiceQuality(blockchain, serviceNode, elapsedTime, result, 300, session, timeout)
  }

  async _updateServiceQuality(
    blockchain: string,
    id: string,
    elapsedTime: number,
    result: number,
    ttl: number,
    session: Session,
    timeout?: number
  ): Promise<void> {
    // Fetch and update the relay timing log; the raw list of elapsed relay times
    let relayTimingLog = []
    const rawRelayTimingLog = await this.redis.get(`{${blockchain}}-${id}-relayTimingLog`)

    // If no timing log is found, set a blank one to guarantee 5 minute expiry
    if (!rawRelayTimingLog) {
      await this.redis.set(`{${blockchain}}-${id}-relayTimingLog`, '[]', 'EX', 300)
    } else {
      relayTimingLog = JSON.parse(rawRelayTimingLog)
    }

    if (result === 200) {
      // Add our new elapsed time to the relay timing log, sort it, and reduce it if necessary
      relayTimingLog.push(elapsedTime)
      relayTimingLog = this.reduceArray(relayTimingLog.sort((a, b) => a - b))

      await this.redis.set(`{${blockchain}}-${id}-relayTimingLog`, JSON.stringify(relayTimingLog), 'KEEPTTL')
    }

    // Bucket the relay timing log into quantiles
    const bucketedServiceQuality = this.bucketArray(relayTimingLog)

    // Pull the full service log including weighted latency and success rate
    const serviceLog = await this.fetchRawServiceLog(blockchain, id)

    // Get calculated data for analytics
    const unsortedLog = await this.createUnsortedLog(id, blockchain, serviceLog, undefined, '0')

    let serviceQuality: {
      results: unknown
      medianSuccessLatency: string
      weightedSuccessLatency: string
      sessionKey: string
      sessionHeight: string | number
      metadata: {
        p90: number
        attempts: number
        successRate: number
      }
    }

    // Update service quality log for this time period
    if (serviceLog) {
      serviceQuality = JSON.parse(serviceLog)

      let totalResults = 0

      for (const logResult of Object.keys(serviceQuality.results)) {
        // Add the current result into the total results
        if (parseInt(logResult) === result) {
          serviceQuality.results[logResult]++
        }
        totalResults = totalResults + serviceQuality.results[logResult]
      }
      // Does this result not yet exist in the set?
      if (!serviceQuality.results[result] || serviceQuality.results[result] === 0) {
        totalResults++
        serviceQuality.results[result] = 1
      }
      // Success; recompute the weighted latency
      if (result === 200) {
        serviceQuality.medianSuccessLatency = bucketedServiceQuality.median.toFixed(5)
        serviceQuality.weightedSuccessLatency = serviceQuality.medianSuccessLatency
        // Weighted latency is the median elapsed time + 50% (p90 elapsed time)
        // This weights the nodes better than a simple average
        // Don't use weighting until there have been at least 20 requests
        if (totalResults > 20) {
          serviceQuality.weightedSuccessLatency = (
            bucketedServiceQuality.median +
            0.3 * bucketedServiceQuality.p90
          ).toFixed(5)
        }
        serviceQuality.metadata = {
          p90: bucketedServiceQuality.p90,
          attempts: unsortedLog.attempts,
          successRate: unsortedLog.successRate,
        }
      } else {
        await this.updateBadNodeTimeoutQuality(blockchain, id, elapsedTime, timeout, session)
      }
    } else {
      // No current logs found for this period
      const results = { [result]: 1 }

      if (result !== 200) {
        elapsedTime = 0
        await this.updateBadNodeTimeoutQuality(blockchain, id, elapsedTime, timeout, session)
      }
      serviceQuality = {
        results: results,
        medianSuccessLatency: elapsedTime.toFixed(5),
        weightedSuccessLatency: elapsedTime.toFixed(5),
        sessionKey: session.key,
        sessionHeight: session.header.sessionBlockHeight,
        metadata: {
          p90: bucketedServiceQuality.p90,
          attempts: 1,
          successRate: unsortedLog.successRate,
        },
      }
    }

    await this.redis.set(`{${blockchain}}-${id}-service`, JSON.stringify(serviceQuality), 'EX', ttl)
  }

  reduceArray(raw: number[]): number[] {
    // Drop half of the array entries if it is over 500 elements.
    // 500 is enough to get a good picture of the node's responses without making
    // excessively long cache keys or arrays to sort.
    if (raw.length > 500) {
      const reducedArray = raw.filter(function (_, i) {
        return (i + 1) % 2
      })

      return reducedArray
    }
    return raw
  }

  bucketArray(raw: number[]): SortedServiceQuality {
    const median = this.quantile(raw, 0.5)
    const p90 = this.quantile(raw, 0.9)

    return { median, p90 } as SortedServiceQuality
  }

  quantile = (arr: number[], q: number): number => {
    const pos = (arr.length - 1) * q
    const base = Math.floor(pos)
    const rest = pos - base

    if (arr[base + 1] !== undefined) {
      return arr[base] + rest * (arr[base + 1] - arr[base])
    } else {
      return arr[base]
    }
  }

  /**
   * Nodes may fail ocasionally due to misconfigured timeouts, this can specially
   * hurt on archival chains where big operations require more time (and greater
   * timeouts) to operate. When a node continously fail due to the misconfiguration,
   * is removed from the session
   * @param blockchain blockchain to relay from
   * @param serviceNode node's public key
   * @param elapsedTime time elapsed in seconds
   * @param requestTimeout request timeout allowed, in seconds
   * @param sessionKey session's key
   * @returns
   */
  async updateBadNodeTimeoutQuality(
    blockchain: string,
    serviceNode: string,
    elapsedTime: number,
    requestTimeout: number | undefined,
    pocketSession?: Session
  ): Promise<void> {
    // TODO: Improve naming
    const { key: sessionKey } = pocketSession || {}

    // FIXME: This is not a reliable way on asserting whether is a service node,
    // an issue was created on pocket-tools for a 'isPublicKey' function. Once is
    // implemented, replace with the function.
    if (this.archivalChains.indexOf(blockchain) < 0 || serviceNode.length !== 64) {
      return
    }

    let timeoutCounter = 0
    const key = `node-${serviceNode}-${sessionKey}-timeout`
    const timeoutCounterCached = await this.redis.get(key)

    if (timeoutCounterCached) {
      timeoutCounter = parseInt(timeoutCounterCached)
    }

    if (requestTimeout && requestTimeout - elapsedTime > TIMEOUT_VARIANCE) {
      await this.redis.set(key, ++timeoutCounter, 'EX', 60 * 60 * 2) // 2 Hours

      if (timeoutCounter >= TIMEOUT_LIMIT) {
        logger.log('warn', `removed archival node from session due to timeouts: ${serviceNode}`, {
          serviceNode,
          sessionKey,
        })
        await removeNodeFromSession(this.redis as unknown as Cache, pocketSession, serviceNode, true, '', blockchain)
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async rankItems(blockchain: string, sortedLogs: Array<ServiceLog>, maxFailuresPerPeriod: number): Promise<any[]> {
    const rankedItems = []
    // weightFactor pushes the fastest apps/nodes with the highest success rates
    // to be called on more often for relays.
    //
    // The app/node with the highest success rate and the lowest median latency will
    // be 10 times more likely to be selected than a node that has had failures.
    let weightFactor = 10
    let previousNodeLatency = 0

    for (const sortedLog of sortedLogs) {
      let latencyDifference = 0

      // Benchmark this current node's latency against the previous in the list
      let benchmark = previousNodeLatency

      // Only count the latency difference if this node is slower than the expected success latency
      if (previousNodeLatency > 0 && sortedLog.medianSuccessLatency > EXPECTED_SUCCESS_LATENCY) {
        // If previous node latency is faster than expected success, use the expected as the benchmark
        if (previousNodeLatency < EXPECTED_SUCCESS_LATENCY) {
          benchmark = EXPECTED_SUCCESS_LATENCY
        }

        latencyDifference = sortedLog.weightedSuccessLatency - benchmark
      }

      // The amount you subtract here from the weight factor should be variable based on how
      // far off this node's average elapsedTime is from the fastest node.
      // Previously this value was hardcoded 2 in the first bucket
      if (latencyDifference) {
        weightFactor = weightFactor - Math.round(latencyDifference * WEIGHT_MULTIPLIER)

        if (weightFactor <= 0) {
          weightFactor = sortedLog.attempts >= maxFailuresPerPeriod ? 0 : 1
        }
      }

      // Brand new sessions include all nodes in this group so we avoid putting failures here
      if (sortedLog.successRate > 0.95 && !sortedLog.failure) {
        // For untested apps/nodes and those > 95% success rates, weight their selection
        for (let x = 1; x <= weightFactor; x++) {
          rankedItems.push(sortedLog.id)
        }
      } else if (sortedLog.successRate > 0 && !sortedLog.failure) {
        // For all apps/nodes with limited success rate, do not weight
        rankedItems.push(sortedLog.id)
      } else {
        // If an app/node has a 0% success rate and < max failures, keep them in rotation
        if (sortedLog.attempts < maxFailuresPerPeriod) {
          rankedItems.push(sortedLog.id)

          // If an app/node has a 0% success rate and >= max failures shelve them until next period
        } else {
          // If a node has been shelved, mark it as questionable so that in the future, it is never
          // put into the maximum weighting category.
          // Once a node has performed well enough in a session, check to see if it is marked
          // If so, erase the scarlet letter
          if (!sortedLog.failure) {
            await this.redis.set(`{${blockchain}}-${sortedLog.id}-failure`, 'true', 'EX', 300)
          }
        }
      }
      // Set the benchmark for the next node
      previousNodeLatency = sortedLog.weightedSuccessLatency
    }

    return rankedItems
  }

  async createUnsortedLog(
    id: string,
    blockchain: string,
    rawServiceLog: string,
    rawFailureLog: string,
    rawErrorLog: string
  ): Promise<ServiceLog> {
    // Default values mean that an App/Node hasn't had a relay in the past hour gets a
    // Success rate of 1; this boosts it into the primary group so it gets tested
    let attempts = 0
    let successRate = 1
    let medianSuccessLatency = 0
    let weightedSuccessLatency = 0
    let failure = false

    if (!rawErrorLog) {
      rawErrorLog = '0'
    }

    // Check here to see if it was shelved the last time it was in a session
    // If so, mark it in the service log
    failure = rawFailureLog === 'true' || parseInt(rawErrorLog) > 50

    if (rawServiceLog) {
      const parsedLog = JSON.parse(rawServiceLog)

      // Count total relay attempts with any result
      for (const result of Object.keys(parsedLog.results)) {
        attempts = attempts + parsedLog.results[result]
      }

      // Has the node had any success in the past hour?
      if (parsedLog.results['200'] > 0) {
        // If previously marked as failure, erase that
        if (failure) {
          failure = false
          await this.redis.set(`{${blockchain}}-${id}-failure`, 'false', 'EX', 60 * 60 * 24 * 30)
        }
        successRate = parsedLog.results['200'] / attempts
        medianSuccessLatency = parseFloat(parseFloat(parsedLog.medianSuccessLatency).toFixed(5))
        weightedSuccessLatency = parseFloat(parseFloat(parsedLog.weightedSuccessLatency).toFixed(5))
      }
    }

    return {
      id,
      attempts,
      successRate,
      medianSuccessLatency,
      weightedSuccessLatency,
      failure,
    }
  }

  sortLogs(array: ServiceLog[]): ServiceLog[] {
    const sortedLogs = array.sort((a: ServiceLog, b: ServiceLog) => {
      if (a.weightedSuccessLatency > b.weightedSuccessLatency) {
        return 1
      } else if (a.weightedSuccessLatency < b.weightedSuccessLatency) {
        return -1
      }
      return 0
    })

    return sortedLogs
  }
}

type ServiceLog = {
  id: string
  attempts: number
  successRate: number
  medianSuccessLatency: number
  weightedSuccessLatency: number
  failure: boolean
}

type SortedServiceQuality = {
  median: number
  p90: number
}
