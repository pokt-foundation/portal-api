"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger = require('../services/logger');
class CherryPicker {
    constructor({ redis, checkDebug }) {
        this.redis = redis;
        this.checkDebug = checkDebug;
    }
    // Record the latency and success rate of each application, 15 minute TTL
    // When selecting an application, pull the stats for each application in the load balancer
    // Rank and weight them for application choice
    async cherryPickApplication(loadBalancerID, applications, blockchain, requestID) {
        let sortedLogs = [];
        for (const application of applications) {
            const rawServiceLog = await this.fetchRawServiceLog(blockchain, application);
            sortedLogs.push(await this.createUnsortedLog(application, blockchain, rawServiceLog));
        }
        // Sort application logs by highest success rate, then by lowest latency
        sortedLogs = this.sortLogs(sortedLogs, requestID, 'LB', loadBalancerID);
        // Iterate through sorted logs and form in to a weighted list 
        // 15 failures per 15 minutes allowed on apps (all 5 nodes failed 3 times)
        let rankedItems = await this.rankItems(blockchain, sortedLogs, 15);
        // If we have no applications left because all are failures, ¯\_(ツ)_/¯
        if (rankedItems.length === 0) {
            logger.log('warn', 'Cherry picking failure -- apps', { requestID: requestID, relayType: 'LB', typeID: loadBalancerID, serviceNode: '' });
            rankedItems = applications;
        }
        const selectedApplication = Math.floor(Math.random() * rankedItems.length);
        const application = rankedItems[selectedApplication];
        if (this.checkDebug) {
            logger.log('debug', 'Number of weighted applications for selection: ' + rankedItems.length, { requestID: requestID, relayType: 'LB', typeID: loadBalancerID });
            logger.log('debug', 'Selected ' + selectedApplication + ' : ' + application, { requestID: requestID, relayType: 'LB', typeID: loadBalancerID });
        }
        return application;
    }
    // Record the latency and success rate of each node, 1 hour TTL
    // When selecting a node, pull the stats for each node in the session
    // Rank and weight them for node choice
    async cherryPickNode(application, nodes, blockchain, requestID) {
        const rawNodes = {};
        const rawNodeIDs = [];
        let sortedLogs = [];
        for (const node of nodes) {
            rawNodes[node.publicKey] = node;
            rawNodeIDs.push(node.publicKey);
            const rawServiceLog = await this.fetchRawServiceLog(blockchain, node.publicKey);
            sortedLogs.push(await this.createUnsortedLog(node.publicKey, blockchain, rawServiceLog));
        }
        // Sort node logs by highest success rate, then by lowest latency
        sortedLogs = this.sortLogs(sortedLogs, requestID, 'APP', application.id);
        // Iterate through sorted logs and form in to a weighted list 
        // If you fail your first relay in the session, go to the back of the line
        let rankedItems = await this.rankItems(blockchain, sortedLogs, 1);
        // If we have no nodes left because all 5 are failures, ¯\_(ツ)_/¯
        if (rankedItems.length === 0) {
            logger.log('warn', 'Cherry picking failure -- nodes', { requestID: requestID, relayType: 'APP', typeID: application.id, serviceNode: '' });
            rankedItems = rawNodeIDs;
        }
        const selectedNode = Math.floor(Math.random() * rankedItems.length);
        const node = rawNodes[rankedItems[selectedNode]];
        if (this.checkDebug) {
            logger.log('debug', 'Number of weighted nodes for selection: ' + rankedItems.length, { requestID: requestID, relayType: 'APP', typeID: application.id, serviceNode: '' });
            logger.log('debug', 'Selected ' + selectedNode + ' : ' + node.publicKey, { requestID: requestID, relayType: 'APP', typeID: application.id, serviceNode: '' });
        }
        return node;
    }
    // Fetch app/node's service log from redis
    async fetchRawServiceLog(blockchain, id) {
        const rawServiceLog = await this.redis.get(blockchain + '-' + id + '-service');
        return rawServiceLog;
    }
    // Fetch app/node's overall failure true/false log from redis
    async fetchRawFailureLog(blockchain, id) {
        const rawFailureLog = await this.redis.get(blockchain + '-' + id + '-failure');
        return rawFailureLog;
    }
    // Fetch node client type if Ethereum based
    async fetchClientTypeLog(blockchain, id) {
        const clientTypeLog = await this.redis.get(blockchain + '-' + id + '-clientType');
        return clientTypeLog;
    }
    // Record app & node service quality in redis for future selection weight
    // { id: { results: { 200: x, 500: y, ... }, averageSuccessLatency: z }
    async updateServiceQuality(blockchain, applicationID, serviceNode, elapsedTime, result) {
        await this._updateServiceQuality(blockchain, applicationID, elapsedTime, result, 900);
        await this._updateServiceQuality(blockchain, serviceNode, elapsedTime, result, 7200);
    }
    async _updateServiceQuality(blockchain, id, elapsedTime, result, ttl) {
        const serviceLog = await this.fetchRawServiceLog(blockchain, id);
        let serviceQuality;
        // Update service quality log for this time period
        if (serviceLog) {
            serviceQuality = JSON.parse(serviceLog);
            let totalResults = 0;
            for (const logResult of Object.keys(serviceQuality.results)) {
                // Add the current result into the total results
                if (parseInt(logResult) === result) {
                    serviceQuality.results[logResult]++;
                }
                totalResults = totalResults + serviceQuality.results[logResult];
            }
            // Does this result not yet exist in the set?
            if (!serviceQuality.results[result] ||
                serviceQuality.results[result] === 0) {
                totalResults++;
                serviceQuality.results[result] = 1;
            }
            // Success; add this result's latency to the average latency of all success requests
            if (result === 200) {
                serviceQuality.averageSuccessLatency = (((totalResults - 1) * serviceQuality.averageSuccessLatency +
                    elapsedTime) / // All previous results plus current
                    totalResults) // divided by total results
                    .toFixed(5); // to 5 decimal points
            }
        }
        else {
            // No current logs found for this hour
            const results = { [result]: 1 };
            if (result !== 200) {
                elapsedTime = 0;
            }
            serviceQuality = {
                results: results,
                averageSuccessLatency: elapsedTime.toFixed(5),
            };
        }
        await this.redis.set(blockchain + '-' + id + '-service', JSON.stringify(serviceQuality), 'EX', ttl);
    }
    async rankItems(blockchain, sortedLogs, maxFailuresPerPeriod) {
        const rankedItems = [];
        // weightFactor pushes the fastest apps/nodes with the highest success rates
        // to be called on more often for relays.
        //
        // The app/node with the highest success rate and the lowest average latency will
        // be 10 times more likely to be selected than a node that has had failures.
        let weightFactor = 10;
        for (const sortedLog of sortedLogs) {
            // Brand new sessions include all nodes in this group so we avoid putting failures here
            if (sortedLog.successRate > 0.98 && !sortedLog.failure) {
                // For untested apps/nodes and those > 98% success rates, weight their selection
                for (let x = 1; x <= weightFactor; x++) {
                    rankedItems.push(sortedLog.id);
                }
                weightFactor = weightFactor - 2;
            }
            else if (sortedLog.successRate > 0.95 && !sortedLog.failure) {
                // For all apps/nodes with reasonable success rate, weight their selection less
                for (let x = 1; x <= weightFactor; x++) {
                    rankedItems.push(sortedLog.id);
                }
                weightFactor = weightFactor - 3;
                if (weightFactor <= 0) {
                    weightFactor = 1;
                }
            }
            else if (sortedLog.successRate > 0) {
                // For all apps/nodes with limited success rate, do not weight
                rankedItems.push(sortedLog.id);
            }
            else if (sortedLog.successRate === 0) {
                // If an app/node has a 0% success rate and < max failures, keep them in rotation
                if (sortedLog.attempts < maxFailuresPerPeriod) {
                    rankedItems.push(sortedLog.id);
                }
                // If an app/node has a 0% success rate and >= max failures shelve them until next period
                else {
                    // If a node has been shelved, mark it as questionable so that in the future, it is never
                    // put into the maximum weighting category.
                    // Once a node has performed well enough in a session, check to see if it is marked
                    // If so, erase the scarlet letter
                    if (!sortedLog.failure) {
                        await this.redis.set(blockchain + '-' + sortedLog.id + '-failure', 'true', 'EX', (60 * 60 * 24 * 30));
                    }
                }
            }
        }
        return rankedItems;
    }
    async createUnsortedLog(id, blockchain, rawServiceLog) {
        let attempts = 0;
        let successRate = 0;
        let averageSuccessLatency = 0;
        let failure = false;
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
        const failureLog = await this.fetchRawFailureLog(blockchain, id);
        // Pull the error log to see how many errors in a row; if > 5, mark as failure
        let errorLog = await this.redis.get(blockchain + '-' + id + '-errors');
        if (!errorLog) {
            errorLog = '0';
        }
        failure = ((failureLog === 'true') || (parseInt(errorLog) > 5));
        if (!rawServiceLog) {
            // App/Node hasn't had a relay in the past hour
            // Success rate of 1 boosts this node into the primary group so it gets tested
            successRate = 1;
            averageSuccessLatency = 0;
        }
        else {
            const parsedLog = JSON.parse(rawServiceLog);
            // Count total relay atttempts with any result
            for (const result of Object.keys(parsedLog.results)) {
                attempts = attempts + parsedLog.results[result];
            }
            // Has the node had any success in the past hour?
            if (parsedLog.results['200'] > 0) {
                // If previously marked as failure, erase that
                if (failure) {
                    failure = false;
                    await this.redis.set(blockchain + '-' + id + '-failure', 'false', 'EX', (60 * 60 * 24 * 30));
                }
                successRate = parsedLog.results['200'] / attempts;
                averageSuccessLatency = parseFloat(parseFloat(parsedLog.averageSuccessLatency).toFixed(5));
            }
        }
        return {
            id: id,
            attempts: attempts,
            successRate: successRate,
            averageSuccessLatency: averageSuccessLatency,
            failure: failure,
        };
    }
    sortLogs(array, requestID, relayType, typeID) {
        const sortedLogs = array.sort((a, b) => {
            if (a.successRate < b.successRate) {
                return 1;
            }
            else if (a.successRate > b.successRate) {
                return -1;
            }
            if (a.successRate === b.successRate) {
                if (a.averageSuccessLatency > b.averageSuccessLatency) {
                    return 1;
                }
                else if (a.averageSuccessLatency < b.averageSuccessLatency) {
                    return -1;
                }
                return 0;
            }
            return 0;
        });
        if (this.checkDebug) {
            logger.log('debug', 'Sorted logs: ' + JSON.stringify(sortedLogs), { requestID: requestID, relayType: relayType, typeID: typeID, serviceNode: '' });
        }
        return sortedLogs;
    }
    ;
}
exports.CherryPicker = CherryPicker;
//# sourceMappingURL=cherry-picker.js.map