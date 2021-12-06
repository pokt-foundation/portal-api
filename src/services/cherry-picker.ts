import { Redis } from 'ioredis'
import { Node, Session } from '@pokt-network/pocket-js'
import { Applications } from '../models'
import { getNodeNetworkData, removeNodeFromSession } from '../utils/cache'
import { hashBlockchainNodes } from '../utils/helpers'

const logger = require('../services/logger')

// Amount of times a node is allowed to fail due to misconfigured timeout before
// being removed from the session
const TIMEOUT_LIMIT = 20

// Allowed difference on timeout, expressed in seconds, as the timeout usually
// wont be exact
const TIMEOUT_VARIANCE = 2

export class CherryPicker {
  checkDebug: boolean
  redis: Redis
  archivalChains: string[]

  constructor({ redis, checkDebug, archivalChains }: { redis: Redis; checkDebug: boolean; archivalChains?: string[] }) {
    this.redis = redis
    this.checkDebug = checkDebug
    this.archivalChains = archivalChains || []
  }

  // Record the latency and success rate of each application, 15 minute TTL
  // When selecting an application, pull the stats for each application in the load balancer
  // Rank and weight them for application choice
  async cherryPickApplication(
    loadBalancerID: string,
    applications: Array<string>,
    blockchain: string,
    requestID: string
  ): Promise<string> {
    let sortedLogs = [] as {
      id: string
      attempts: number
      successRate: number
      averageSuccessLatency: number
      failure: boolean
    }[]

    for (const application of applications) {
      const rawServiceLog = await this.fetchRawServiceLog(blockchain, application)

      sortedLogs.push(await this.createUnsortedLog(application, blockchain, rawServiceLog!))
    }

    // Sort application logs by highest success rate, then by lowest latency
    sortedLogs = this.sortLogs(sortedLogs, requestID, 'LB', loadBalancerID)

    // Iterate through sorted logs and form in to a weighted list
    // 50 failures per 5 minutes allowed on apps (all 5 nodes failed 3 times)
    let rankedItems = await this.rankItems(blockchain, sortedLogs, 50)

    // If we have no applications left because all are failures, ¯\_(ツ)_/¯
    if (rankedItems.length === 0) {
      logger.log('warn', 'Cherry picking failure -- apps', {
        requestID: requestID,
        relayType: 'LB',
        typeID: loadBalancerID,
        serviceNode: '',
        blockchainID: blockchain,
      })
      rankedItems = applications
    }

    const selectedApplication = Math.floor(Math.random() * rankedItems.length)
    const application = rankedItems[selectedApplication]

    if (this.checkDebug) {
      logger.log('info', 'Number of weighted applications for selection: ' + rankedItems.length, {
        requestID: requestID,
        relayType: 'LB',
        typeID: loadBalancerID,
        blockchainID: blockchain,
      })
      logger.log('info', 'Selected ' + selectedApplication + ' : ' + application, {
        requestID: requestID,
        relayType: 'LB',
        typeID: loadBalancerID,
        blockchainID: blockchain,
      })
    }
    return application
  }

  // Record the latency and success rate of each node, 1 hour TTL
  // When selecting a node, pull the stats for each node in the session
  // Rank and weight them for node choice
  async cherryPickNode(application: Applications, nodes: Node[], blockchain: string, requestID: string): Promise<Node> {
    const rawNodes = {} as { [nodePublicKey: string]: Node }
    const rawNodeIDs = [] as string[]
    let sortedLogs = [] as {
      id: string
      attempts: number
      successRate: number
      averageSuccessLatency: number
      failure: boolean
    }[]

    for (const node of nodes) {
      rawNodes[node.publicKey] = node
      rawNodeIDs.push(node.publicKey)
      const rawServiceLog = await this.fetchRawServiceLog(blockchain, node.publicKey)

      sortedLogs.push(await this.createUnsortedLog(node.publicKey, blockchain, rawServiceLog!))
    }

    // Sort node logs by highest success rate, then by lowest latency
    sortedLogs = this.sortLogs(sortedLogs, requestID, 'APP', application.id)

    // Iterate through sorted logs and form in to a weighted list
    let rankedItems = await this.rankItems(blockchain, sortedLogs, 50)

    // If we have no nodes left because all 5 are failures, ¯\_(ツ)_/¯
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

  // Fetch app/node's service log from redis
  async fetchRawServiceLog(blockchain: string, id: string | undefined): Promise<string | null> {
    const rawServiceLog = await this.redis.get(blockchain + '-' + id + '-service')

    return rawServiceLog
  }

  // Fetch app/node's overall failure true/false log from redis
  async fetchRawFailureLog(blockchain: string, id: string | undefined): Promise<string | null> {
    const rawFailureLog = await this.redis.get(blockchain + '-' + id + '-failure')

    return rawFailureLog
  }

  // Record app & node service quality in redis for future selection weight
  // { id: { results: { 200: x, 500: y, ... }, averageSuccessLatency: z }
  async updateServiceQuality(
    blockchainID: string,
    applicationID: string,
    serviceNode: string,
    elapsedTime: number,
    result: number,
    timeout?: number,
    pocketSession?: Session
  ): Promise<void> {
    await this._updateServiceQuality(blockchainID, applicationID, elapsedTime, result, 300, timeout, pocketSession)
    await this._updateServiceQuality(blockchainID, serviceNode, elapsedTime, result, 300, timeout, pocketSession)
  }

  async _updateServiceQuality(
    blockchainID: string,
    id: string,
    elapsedTime: number,
    result: number,
    ttl: number,
    timeout?: number,
    pocketSession?: Session
  ): Promise<void> {
    const serviceLog = await this.fetchRawServiceLog(blockchainID, id)

    let serviceQuality

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
      // Success; add this result's latency to the average latency of all success requests
      if (result === 200) {
        serviceQuality.averageSuccessLatency = (
          ((totalResults - 1) * serviceQuality.averageSuccessLatency + elapsedTime) / // All previous results plus current
          totalResults
        ) // divided by total results
          .toFixed(5) // to 5 decimal points
      } else {
        await this.updateBadNodeTimeoutQuality(blockchainID, id, elapsedTime, timeout, pocketSession)
      }
    } else {
      // No current logs found for this hour
      const results = { [result]: 1 }

      if (result !== 200) {
        elapsedTime = 0
        await this.updateBadNodeTimeoutQuality(blockchainID, id, elapsedTime, timeout, pocketSession)
      }
      serviceQuality = {
        results: results,
        averageSuccessLatency: elapsedTime.toFixed(5),
      }
    }

    await this.redis.set(blockchainID + '-' + id + '-service', JSON.stringify(serviceQuality), 'EX', ttl)
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
    blockchainID: string,
    serviceNode: string,
    elapsedTime: number,
    requestTimeout: number | undefined,
    pocketSession?: Session
  ): Promise<void> {
    const { sessionKey, sessionNodes } = pocketSession || {}
    const sessionHash = hashBlockchainNodes(blockchainID, sessionNodes)

    // FIXME: This is not a reliable way on asserting whether is a service node,
    // an issue was created on pocket-tools for a 'isPublicKey' function. Once is
    // implemented, replace with the function.
    if (this.archivalChains.indexOf(blockchainID) < 0 || serviceNode.length !== 64) {
      return
    }

    let timeoutCounter = 0
    const key = `node-${serviceNode}-${sessionHash}-timeout`
    const timeoutCounterCached = await this.redis.get(key)

    if (timeoutCounterCached) {
      timeoutCounter = parseInt(timeoutCounterCached)
    }

    if (requestTimeout && requestTimeout - elapsedTime > TIMEOUT_VARIANCE) {
      await this.redis.set(key, ++timeoutCounter, 'EX', 60 * 60 * 2) // 2 Hours

      if (timeoutCounter >= TIMEOUT_LIMIT) {
        const { serviceURL, serviceDomain } = await getNodeNetworkData(this.redis, serviceNode)

        logger.log('warn', `removed archival node from session due to timeouts: ${serviceNode}`, {
          serviceNode,
          sessionKey,
          serviceURL,
          serviceDomain,
          sessionHash,
        })
        await removeNodeFromSession(this.redis, blockchainID, sessionNodes, serviceNode)
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async rankItems(blockchain: string, sortedLogs: Array<ServiceLog>, maxFailuresPerPeriod: number): Promise<any[]> {
    const rankedItems = []
    // weightFactor pushes the fastest apps/nodes with the highest success rates
    // to be called on more often for relays.
    //
    // The app/node with the highest success rate and the lowest average latency will
    // be 10 times more likely to be selected than a node that has had failures.
    let weightFactor = 10
    let previousNodeLatency = 0
    let latencyDifference = 0

    // This multiplier is tested to produce a curve that adequately punishes slow nodes
    const weightMultiplier = 15

    for (const sortedLog of sortedLogs) {
      // Set the benchmark from the previous node and measure the delta
      if (!previousNodeLatency) {
        previousNodeLatency = sortedLog.averageSuccessLatency
      } else {
        latencyDifference = sortedLog.averageSuccessLatency - previousNodeLatency
      }

      // The amount you subtract here from the weight factor should be variable based on how
      // far off this node's average elapsedTime is from the fastest node.
      // Previously this value was hardcoded 2 in the first bucket
      if (latencyDifference) {
        weightFactor = weightFactor - Math.round(latencyDifference * weightMultiplier)

        if (weightFactor <= 0) {
          weightFactor = 1
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
            await this.redis.set(blockchain + '-' + sortedLog.id + '-failure', 'true', 'EX', 300)
          }
        }
      }
    }
    return rankedItems
  }

  async createUnsortedLog(id: string, blockchain: string, rawServiceLog: string): Promise<ServiceLog> {
    let attempts = 0
    let successRate = 0
    let averageSuccessLatency = 0
    let failure = false

    /*
    Client Type filtering: 
    
    let clientType = '';

    // Pull client type for any necessary filtering
    const clientTypeLog = await this.fetchClientTypeLog(blockchain, id);

    Sample Filter:
    if (clientTypeLog && clientTypeLog.includes('OpenEthereum')) {
        logger.log('info', 'OPENETHEREUM MARKED', {requestID: '', relayType: '', typeID: '', serviceNode: id});
        clientType = 'OpenEthereum';
    }
    Before the return, mark this client with 0 success rate and 100 attempts so it is excluded completely.
    */

    // Check here to see if it was shelved the last time it was in a session
    // If so, mark it in the service log
    const failureLog = await this.fetchRawFailureLog(blockchain, id)

    // Pull the error log to see how many errors in a row; if > 5, mark as failure
    let errorLog = await this.redis.get(blockchain + '-' + id + '-errors')

    if (!errorLog) {
      errorLog = '0'
    }

    failure = failureLog === 'true' || parseInt(errorLog) > 50

    if (!rawServiceLog) {
      // App/Node hasn't had a relay in the past hour
      // Success rate of 1 boosts this node into the primary group so it gets tested
      successRate = 1
      averageSuccessLatency = 0
    } else {
      const parsedLog = JSON.parse(rawServiceLog)

      // Count total relay atttempts with any result
      for (const result of Object.keys(parsedLog.results)) {
        attempts = attempts + parsedLog.results[result]
      }

      // Has the node had any success in the past hour?
      if (parsedLog.results['200'] > 0) {
        // If previously marked as failure, erase that
        if (failure) {
          failure = false
          await this.redis.set(blockchain + '-' + id + '-failure', 'false', 'EX', 60 * 60 * 24 * 30)
        }
        successRate = parsedLog.results['200'] / attempts
        averageSuccessLatency = parseFloat(parseFloat(parsedLog.averageSuccessLatency).toFixed(5))
      }
    }

    return {
      id: id,
      attempts: attempts,
      successRate: successRate,
      averageSuccessLatency: averageSuccessLatency,
      failure: failure,
    }
  }

  sortLogs(array: ServiceLog[], requestID: string, relayType: string, typeID: string): ServiceLog[] {
    const sortedLogs = array.sort((a: ServiceLog, b: ServiceLog) => {
      if (a.averageSuccessLatency > b.averageSuccessLatency) {
        return 1
      } else if (a.averageSuccessLatency < b.averageSuccessLatency) {
        return -1
      }
      return 0
    })

    /*
    RE-ENABLE LOGS to examine cherry picker behaviour
    logger.log('info', 'CHERRY PICKER STATS Sorted logs: ' + JSON.stringify(sortedLogs), {
      requestID: requestID,
      relayType: relayType,
      typeID: typeID,
      serviceNode: '',
    })
    */
    return sortedLogs
  }
}

type ServiceLog = {
  id: string
  attempts: number
  successRate: number
  averageSuccessLatency: number
  failure: boolean
}
