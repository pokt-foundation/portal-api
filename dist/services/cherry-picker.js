"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class CherryPicker {
    constructor(redis, checkDebug) {
        this.redis = redis;
        this.checkDebug = checkDebug;
    }
    // Fetch node's hourly service log from redis
    async fetchServiceLog(blockchain, serviceNode) {
        const serviceLog = await this.redis.get(blockchain + "-" + serviceNode + "-" + new Date().getHours());
        return serviceLog;
    }
    // Record node service quality in redis for future node selection weight
    // { serviceNode: { results: { 200: x, 500: y, ... }, averageSuccessLatency: z }
    async updateServiceNodeQuality(blockchain, serviceNode, elapsedTime, result) {
        const serviceLog = await this.fetchServiceLog(blockchain, serviceNode);
        let serviceNodeQuality;
        // Update service quality log for this hour
        if (serviceLog) {
            serviceNodeQuality = JSON.parse(serviceLog);
            let totalResults = 0;
            for (const logResult of Object.keys(serviceNodeQuality.results)) {
                // Add the current result into the total results
                if (parseInt(logResult) === result) {
                    serviceNodeQuality.results[logResult]++;
                }
                totalResults = totalResults + serviceNodeQuality.results[logResult];
            }
            // Does this result not yet exist in the set?
            if (!serviceNodeQuality.results[result] || serviceNodeQuality.results[result] === 0) {
                totalResults++;
                serviceNodeQuality.results[result] = 1;
            }
            // Success; add this result's latency to the average latency of all success requests
            if (result === 200) {
                serviceNodeQuality.averageSuccessLatency = ((((totalResults - 1) * serviceNodeQuality.averageSuccessLatency) + elapsedTime) // All previous results plus current
                    / totalResults // divided by total results
                ).toFixed(5); // to 5 decimal points
            }
        }
        else {
            // No current logs found for this hour
            const results = { [result]: 1 };
            if (result !== 200) {
                elapsedTime = 0;
            }
            serviceNodeQuality = {
                results: results,
                averageSuccessLatency: elapsedTime.toFixed(5)
            };
        }
        await this.redis.set(blockchain + "-" + serviceNode + "-" + new Date().getHours(), JSON.stringify(serviceNodeQuality), "EX", 3600);
        console.log(serviceNode + ": " + JSON.stringify(serviceNodeQuality));
    }
    // Per hour, record the latency and success rate of each node
    // When selecting a node, pull the stats for each node in the session
    // Rank and weight them for node choice
    async cherryPickNode(pocketSession, blockchain) {
        const rawNodes = {};
        const sortedLogs = [];
        for (const node of pocketSession.sessionNodes) {
            rawNodes[node.publicKey] = node;
            const serviceLog = await this.fetchServiceLog(blockchain, node.publicKey);
            if (this.checkDebug) {
                console.log(serviceLog);
            }
            let attempts = 0;
            let successRate = 0;
            let averageSuccessLatency = 0;
            if (!serviceLog) {
                // Node hasn't had a relay in the past hour
                // Success rate of 1 boosts this node into the primary group so it gets tested
                successRate = 1;
                averageSuccessLatency = 0;
            }
            else {
                const parsedLog = JSON.parse(serviceLog);
                // Count total relay atttempts with any result
                for (const result of Object.keys(parsedLog.results)) {
                    attempts = attempts + parsedLog.results[result];
                }
                // Has the node had any success in the past hour?
                if (parsedLog.results["200"] > 0) {
                    successRate = (parsedLog.results["200"] / attempts);
                    averageSuccessLatency = parseFloat(parseFloat(parsedLog.averageSuccessLatency).toFixed(5));
                }
            }
            sortedLogs.push({
                nodePublicKey: node.publicKey,
                attempts: attempts,
                successRate: successRate,
                averageSuccessLatency: averageSuccessLatency,
            });
        }
        ;
        // Sort node logs by highest success rate, then by lowest latency
        sortedLogs.sort((a, b) => {
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
        // Iterate through sorted logs and form in to a weighted list of nodes
        let rankedNodes = [];
        // weightFactor pushes the fastest nodes with the highest success rates 
        // to be called on more often for relays.
        // 
        // The node with the highest success rate and the lowest average latency will
        // be 10 times more likely to be selected than a node that has had failures.
        let weightFactor = 10;
        // The number of failures tolerated per hour (with zero success) before being removed
        const maxFailuresPerHour = 3;
        for (const sortedLog of sortedLogs) {
            if (sortedLog.successRate === 1) {
                // For untested nodes and nodes with 100% success rates, weight their selection
                for (let x = 1; x <= weightFactor; x++) {
                    rankedNodes.push(rawNodes[sortedLog.nodePublicKey]);
                }
                weightFactor = weightFactor - 2;
            }
            else if (sortedLog.successRate > 0.95) {
                // For all nodes with reasonable success rate, weight their selection less
                for (let x = 1; x <= weightFactor; x++) {
                    rankedNodes.push(rawNodes[sortedLog.nodePublicKey]);
                }
                weightFactor = weightFactor - 3;
                if (weightFactor <= 0) {
                    weightFactor = 1;
                }
            }
            else if (sortedLog.successRate > 0) {
                // For all nodes with limited success rate, do not weight
                rankedNodes.push(rawNodes[sortedLog.nodePublicKey]);
            }
            else if (sortedLog.successRate === 0) {
                // If a node has a 0% success rate and < max failures, keep them in rotation
                // If a node has a 0% success rate and > max failures shelve them until next hour
                if (sortedLog.attempts < maxFailuresPerHour) {
                    rankedNodes.push(rawNodes[sortedLog.nodePublicKey]);
                }
            }
        }
        // If we have no nodes left because all 5 are failures, ¯\_(ツ)_/¯
        if (rankedNodes.length === 0) {
            rankedNodes = pocketSession.sessionNodes;
        }
        const selectedNode = Math.floor(Math.random() * (rankedNodes.length));
        const node = rankedNodes[selectedNode];
        if (this.checkDebug) {
            console.log("Number of weighted nodes for selection: " + rankedNodes.length);
            console.log("Selected " + selectedNode + " : " + node.publicKey);
        }
        return node;
    }
}
exports.CherryPicker = CherryPicker;
//# sourceMappingURL=cherry-picker.js.map