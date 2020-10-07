"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class CherryPicker {
    constructor({ redis, checkDebug }) {
        this.redis = redis;
        this.checkDebug = checkDebug;
    }
    // Record the latency and success rate of each application, 15 minute TTL
    // When selecting an application, pull the stats for each application in the load balancer
    // Rank and weight them for application choice
    async cherryPickApplication(applications, blockchain) {
        let sortedLogs = [];
        for (const application of applications) {
            const rawServiceLog = await this.fetchRawServiceLog(blockchain, application);
            sortedLogs.push(this.createUnsortedLog(application, rawServiceLog));
        }
        // Sort application logs by highest success rate, then by lowest latency
        sortedLogs = this.sortLogs(sortedLogs);
        // Iterate through sorted logs and form in to a weighted list 
        // 10 failures per 15 minutes allowed on apps
        let rankedItems = this.rankItems(sortedLogs, 10);
        // If we have no applications left because all are failures, ¯\_(ツ)_/¯
        if (rankedItems.length === 0) {
            console.log("Cherry picking failure -- apps");
            rankedItems = applications;
        }
        const selectedApplication = Math.floor(Math.random() * rankedItems.length);
        const application = rankedItems[selectedApplication];
        if (this.checkDebug) {
            console.log('Number of weighted applications for selection: ' + rankedItems.length);
            console.log('Selected ' + selectedApplication + ' : ' + application);
        }
        return application;
    }
    // Record the latency and success rate of each node, 1 hour TTL
    // When selecting a node, pull the stats for each node in the session
    // Rank and weight them for node choice
    async cherryPickNode(pocketSession, blockchain) {
        const rawNodes = {};
        const rawNodeIDs = [];
        let sortedLogs = [];
        for (const node of pocketSession.sessionNodes) {
            rawNodes[node.publicKey] = node;
            rawNodeIDs.push(node.publicKey);
            const rawServiceLog = await this.fetchRawServiceLog(blockchain, node.publicKey);
            sortedLogs.push(this.createUnsortedLog(node.publicKey, rawServiceLog));
        }
        // Sort node logs by highest success rate, then by lowest latency
        sortedLogs = this.sortLogs(sortedLogs);
        // Iterate through sorted logs and form in to a weighted list 
        // 3 failures per hour allowed on nodes
        let rankedItems = this.rankItems(sortedLogs, 3);
        // If we have no nodes left because all 5 are failures, ¯\_(ツ)_/¯
        if (rankedItems.length === 0) {
            console.log("Cherry picking failure -- nodes");
            rankedItems = rawNodeIDs;
        }
        const selectedNode = Math.floor(Math.random() * rankedItems.length);
        const node = rawNodes[rankedItems[selectedNode]];
        if (this.checkDebug) {
            console.log('Number of weighted nodes for selection: ' + rankedItems.length);
            console.log('Selected ' + selectedNode + ' : ' + node.publicKey);
        }
        return node;
    }
    // Fetch app/node's hourly service log from redis
    async fetchRawServiceLog(blockchain, id) {
        const rawServiceLog = await this.redis.get(blockchain + '-' + id + '-' + new Date().getHours());
        return rawServiceLog;
    }
    // Record app & node service quality in redis for future selection weight
    // { id: { results: { 200: x, 500: y, ... }, averageSuccessLatency: z }
    async updateServiceQuality(blockchain, applicationID, serviceNode, elapsedTime, result) {
        await this._updateServiceQuality(blockchain, applicationID, elapsedTime, result, 900);
        await this._updateServiceQuality(blockchain, serviceNode, elapsedTime, result, 3600);
    }
    async _updateServiceQuality(blockchain, id, elapsedTime, result, ttl) {
        const serviceLog = await this.fetchRawServiceLog(blockchain, id);
        let serviceQuality;
        // Update service quality log for this hour
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
        await this.redis.set(blockchain + '-' + id + '-' + new Date().getHours(), JSON.stringify(serviceQuality), 'EX', ttl);
        if (this.checkDebug) {
            console.log(id + ': ' + JSON.stringify(serviceQuality));
        }
    }
    rankItems(sortedLogs, maxFailuresPerPeriod) {
        const rankedItems = [];
        // weightFactor pushes the fastest apps/nodes with the highest success rates
        // to be called on more often for relays.
        //
        // The app/node with the highest success rate and the lowest average latency will
        // be 10 times more likely to be selected than a node that has had failures.
        let weightFactor = 10;
        for (const sortedLog of sortedLogs) {
            if (sortedLog.successRate === 1) {
                // For untested apps/nodes and those with 100% success rates, weight their selection
                for (let x = 1; x <= weightFactor; x++) {
                    rankedItems.push(sortedLog.id);
                }
                weightFactor = weightFactor - 2;
            }
            else if (sortedLog.successRate > 0.95) {
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
                // If an app/node has a 0% success rate and > max failures shelve them until next period
                if (sortedLog.attempts < maxFailuresPerPeriod) {
                    rankedItems.push(sortedLog.id);
                }
            }
        }
        return rankedItems;
    }
    createUnsortedLog(id, rawServiceLog) {
        let attempts = 0;
        let successRate = 0;
        let averageSuccessLatency = 0;
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
                successRate = parsedLog.results['200'] / attempts;
                averageSuccessLatency = parseFloat(parseFloat(parsedLog.averageSuccessLatency).toFixed(5));
            }
        }
        return {
            id: id,
            attempts: attempts,
            successRate: successRate,
            averageSuccessLatency: averageSuccessLatency,
        };
    }
    sortLogs(array) {
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
            console.log(sortedLogs);
        }
        return sortedLogs;
    }
    ;
}
exports.CherryPicker = CherryPicker;
//# sourceMappingURL=cherry-picker.js.map