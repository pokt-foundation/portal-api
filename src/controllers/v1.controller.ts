import { inject } from "@loopback/context";
import { FilterExcludingWhere, repository } from "@loopback/repository";
import { post, param, requestBody, HttpErrors } from "@loopback/rest";
import { Applications } from "../models";
import {
  ApplicationsRepository,
  BlockchainsRepository,
} from "../repositories";

import {
  Pocket,
  PocketAAT,
  RpcError,
  Configuration,
  Session,
  Node,
  // ConsensusNode,
  RelayResponse,
} from "@pokt-network/pocket-js";

import { Redis } from "ioredis";
import { Pool as PGPool } from "pg";
import {Encryptor, Decryptor} from "strong-cryptor";

const pgFormat = require("pg-format");

export class V1Controller {
  constructor(
    @inject("secretKey") private secretKey: string,
    @inject("host") private host: string,
    @inject("origin") private origin: string,
    @inject("userAgent") private userAgent: string,
    @inject("contentType") private contentType: string,
    @inject("relayPath") private relayPath: string,
    @inject("pocketInstance") private pocket: Pocket,
    @inject("pocketConfiguration") private pocketConfiguration: Configuration,
    @inject("redisInstance") private redis: Redis,
    @inject("pgPool") private pgPool: PGPool,
    @inject("databaseEncryptionKey") private databaseEncryptionKey: string,
    @inject("processUID") private processUID: string,
    @repository(ApplicationsRepository)
    public applicationsRepository: ApplicationsRepository,
    @repository(BlockchainsRepository)
    private blockchainsRepository: BlockchainsRepository
  ) {}

  @post("/v1/{id}", {
    responses: {
      "200": {
        description: "Relay Response",
        content: {
          "application/json": {},
        },
      },
    },
  })
  async attemptRelay(
    @param.path.string("id") id: string,
    @requestBody({
      description: 'request object value',
      required: true,
      content: {
        'application/json': {}
      }
    }) rawData: object,
    @param.filter(Applications, { exclude: "where" })
    filter?: FilterExcludingWhere<Applications>
  ): Promise<string> {
    // Temporarily only taking in JSON objects
    const data = JSON.stringify(rawData);

    console.log("PROCESSING " + id + " host: " + this.host + " req: " + data);
    const elapsedStart = process.hrtime();

    // Load the requested blockchain
    const cachedBlockchains = await this.redis.get("blockchains");
    let blockchains, blockchain;

    if (!cachedBlockchains) {
      blockchains = await this.blockchainsRepository.find();
      await this.redis.set("blockchains", JSON.stringify(blockchains), "EX", 1);
    } else {
      blockchains = JSON.parse(cachedBlockchains);
    }

    // Split off the first part of the request's host and check for matches
    const blockchainRequest = this.host.split(".")[0];
    const blockchainFilter = blockchains.filter(
      (b: {'blockchain': string}) => b.blockchain.toLowerCase() === blockchainRequest.toLowerCase()
    );

    if (blockchainFilter[0]) {
      blockchain = blockchainFilter[0].hash;
    } else {
      throw new HttpErrors.BadRequest("Incorrect blockchain: " + this.host);
    }

    // Construct Pocket AAT from cache; if not available, use the db
    const cachedApp = await this.redis.get(id);
    let app;

    if (!cachedApp) {
      app = await this.applicationsRepository.findById(id, filter);
      await this.redis.set(id, JSON.stringify(app), "EX", 60);
    } else {
      app = JSON.parse(cachedApp);
    }

    // Check secretKey; is it required? does it pass? -- temp allowance for unencrypted keys
    const decryptor = new Decryptor({key: this.databaseEncryptionKey});
    if (
        app.gatewaySettings.secretKeyRequired // If the secret key is required by app's settings
        &&                                    // and 
        app.gatewaySettings.secretKey         // the app's secret key is set
        &&                                    // and
        (
          !(this.secretKey)                   // the request doesn't contain a secret key
          ||                                  // or
          this.secretKey.length < 32          // the secret key is invalid
          ||                                  // or
          (
            (
              this.secretKey.length === 32
              &&
              this.secretKey !== app.gatewaySettings.secretKey  // the secret key does not match plaintext
            )
            &&                                                  // and 
            (
              this.secretKey.length > 32
              &&
              this.secretKey !== decryptor.decrypt(app.gatewaySettings.secretKey) // does not match encrypted
            )
          )
        )
      ) {
      throw new HttpErrors.Forbidden("SecretKey does not match");
    }

    // Whitelist: origins -- explicit matches
    if (!this.checkWhitelist(app.gatewaySettings.whitelistOrigins, this.origin, "explicit")) {
      throw new HttpErrors.Forbidden(
        "Whitelist Origin check failed: " + this.origin
      );
    }

    // Whitelist: userAgent -- substring matches
    if (
      !this.checkWhitelist(app.gatewaySettings.whitelistUserAgents, this.userAgent, "substring")
    ) {
      throw new HttpErrors.Forbidden(
        "Whitelist User Agent check failed: " + this.userAgent
      );
    }

    // Checks pass; create AAT
    const pocketAAT = new PocketAAT(
      app.gatewayAAT.version,
      app.gatewayAAT.clientPublicKey,
      app.gatewayAAT.applicationPublicKey,
      app.gatewayAAT.applicationSignature
    );
    
    let node;
    // Pull the session so we can get a list of nodes and cherry pick which one to use
    const pocketSession = await this.pocket.sessionManager.getCurrentSession(
      pocketAAT,
      blockchain,
      this.pocketConfiguration
    );
    if (pocketSession instanceof Session) {
      node = await this.cherryPickNode(pocketSession, blockchain);
    }
    
    if (this.checkDebug()) {
      console.log(pocketSession);
    }

    // Send relay and process return: RelayResponse, RpcError, ConsensusNode, or undefined
    const relayResponse = await this.pocket.sendRelay(
      data,
      blockchain,
      pocketAAT,
      this.pocketConfiguration,
      undefined,
      undefined,
      this.relayPath,
      node
    );
    
    if (this.checkDebug()) {
      console.log(relayResponse);
    }

    // Success
    if (relayResponse instanceof RelayResponse) {
      console.log("SUCCESS " + id + " chain: " + blockchain + " req: " + JSON.stringify(data) + " res: " + relayResponse.payload);
      const bytes = Buffer.byteLength(relayResponse.payload, 'utf8');

      await this.recordMetric({
        appPubKey: app.gatewayAAT.applicationPublicKey,
        blockchain,
        serviceNode: relayResponse.proof.servicerPubKey,
        elapsedStart,
        result: 200,
        bytes,
      });
      return relayResponse.payload;
    }
    // Error
    else if (relayResponse instanceof RpcError) {
      console.log("ERROR " + id + " chain: " + blockchain + " req: " + JSON.stringify(data) + " res: " + relayResponse.message);
      const bytes = Buffer.byteLength(relayResponse.message, 'utf8');

      await this.recordMetric({
        appPubKey: app.gatewayAAT.applicationPublicKey,
        blockchain,
        serviceNode: node?.publicKey,
        elapsedStart,
        result: 500,
        bytes,
      });
      throw new HttpErrors.InternalServerError(relayResponse.message);
    }
    // ConsensusNode
    else {
      // TODO: ConsensusNode is a possible return
      throw new HttpErrors.InternalServerError("relayResponse is undefined");
    }
  }

  // Check passed in string against an array of whitelisted items
  // Type can be "explicit" or substring match
  checkWhitelist(tests: string[], check: string, type: string): boolean {
    if (!tests || tests.length === 0) {
      return true;
    }
    if (!check) {
      return false;
    }

    for (const test of tests) {
      if (type === "explicit") {
        if (test.toLowerCase() === check.toLowerCase()) {
          return true;
        }
      } else {
        if (check.toLowerCase().includes(test.toLowerCase())) {
          return true;
        }
      }
    }
    return false;
  }

  // Debug log for testing based on user agent
  checkDebug(): boolean {
    if (
      this.userAgent &&
      this.userAgent.toLowerCase().includes('pocket-debug')
      ) {
      return true;
    }
    return false;
  }

  // Record relay metrics in redis then push to timescaleDB for analytics
  async recordMetric({
    appPubKey,
    blockchain,
    serviceNode,
    elapsedStart,
    result,
    bytes,
  }: {
    appPubKey: string;
    blockchain: string;
    serviceNode: string | undefined;
    elapsedStart: [number, number];
    result: number;
    bytes: number;
  }): Promise<void> {
    try {
      const elapsedEnd = process.hrtime(elapsedStart);
      const elapsedTime = (elapsedEnd[0] * 1e9 + elapsedEnd[1]) / 1e9;

      const metricsValues = [
        new Date(),
        appPubKey,
        blockchain,
        serviceNode,
        elapsedTime,
        result,
        bytes,
      ];

      // Store metrics in redis and every 10 seconds, push to postgres
      const redisMetricsKey = "metrics-" + this.processUID;
      const redisListAge = await this.redis.get("age-" + redisMetricsKey);
      const redisListSize = await this.redis.llen(redisMetricsKey);
      const currentTimestamp = Math.floor(new Date().getTime() / 1000);

      // List has been started in redis and needs to be pushed as timestamp is > 10 seconds old
      if (
        redisListAge &&
        redisListSize > 0 &&
        currentTimestamp > parseInt(redisListAge) + 10
      ) {
        await this.redis.set("age-" + redisMetricsKey, currentTimestamp);
        
        const bulkData = [metricsValues];
        for (let count = 0; count < redisListSize; count++) {
          const redisRecord = await this.redis.lpop(redisMetricsKey);
          bulkData.push(JSON.parse(redisRecord));
        }
        const metricsQuery = pgFormat(
          "INSERT INTO relay VALUES %L",
          bulkData
        );
        this.pgPool.query(metricsQuery);
      } else {
        await this.redis.rpush(redisMetricsKey, JSON.stringify(metricsValues));
      }
      
      if (!redisListAge) {
        await this.redis.set("age-" + redisMetricsKey, currentTimestamp);
      }

      if (serviceNode) {
        await this.updateServiceNodeQuality(blockchain, serviceNode, elapsedTime, result);
      }

    } catch (err) {
      console.log(err.stack);
    }
  }

  // Record node service quality in redis for future node selection weight
  // { serviceNode: { results: { 200: x, 500: y, ... }, averageSuccessLatency: z }
  async updateServiceNodeQuality(blockchain: string, serviceNode: string, elapsedTime: number, result: number): Promise<void> {
  
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
      // Success; add this result's latency to the average latency of all success requests
      if (result === 200) {
        serviceNodeQuality.averageSuccessLatency = (
          (((totalResults - 1) * serviceNodeQuality.averageSuccessLatency) + elapsedTime) // All previous results plus current
              / totalResults // divided by total results
          ).toFixed(5); // to 5 decimal points
      }
    } else {
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

    await this.redis.set(blockchain + "-" + serviceNode + "-"  + new Date().getHours(), JSON.stringify(serviceNodeQuality), "EX", 3600);
    console.log(serviceNodeQuality);
  }
  
  // Fetch node's hourly service log from redis
  async fetchServiceLog(blockchain: string, serviceNode: string): Promise<string | null> {
    const serviceLog = await this.redis.get(blockchain + "-" + serviceNode + "-"  + new Date().getHours());
    return serviceLog;
  }

  // Per hour, record the latency and success rate of each node
  // When selecting a node, pull the stats for each node in the session
  // Rank and weight them for node choice
  async cherryPickNode(pocketSession: Session, blockchain: string): Promise<Node> {
    const rawNodes = {} as { [nodePublicKey: string]: Node};
    const sortedLogs = [] as {nodePublicKey: string, attempts: number, successRate: number, averageSuccessLatency: number}[];

    for (const node of pocketSession.sessionNodes) {
      rawNodes[node.publicKey] = node;
      const serviceLog = await this.fetchServiceLog(blockchain, node.publicKey);
      if (this.checkDebug()) {
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
      } else {
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
    };

    // Sort node logs by highest success rate, then by lowest latency
    sortedLogs.sort((a, b) => {
      if (a.successRate < b.successRate) { 
        return 1;
      } else if (a.successRate > b.successRate) {
        return -1;
      }
      if (a.successRate === b.successRate) {
        if (a.averageSuccessLatency > b.averageSuccessLatency) { 
          return 1;
        } else if (a.averageSuccessLatency < b.averageSuccessLatency) {
          return -1;
        }
        return 0;
      }
      return 0;
    });
    if (this.checkDebug()) {
      console.log(sortedLogs);
    }

    // Iterate through sorted logs and form in to a weighted list of nodes
    let rankedNodes = [] as Node[];

    // weightFactor pushes the fastest nodes with the highest success rates 
    // to be called on more often for relays.
    // 
    // The node with the highest success rate and the lowest average latency will
    // be 10 times more likely to be selected than a node that has had failures.
    let weightFactor = 10;

    // The number of failures tolerated per hour before being removed from rotation
    const maxFailuresPerHour = 10;

    for (const sortedLog of sortedLogs) {
      if (sortedLog.successRate === 1) {
        // For untested nodes and nodes with 100% success rates, weight their selection
        for (let x=1; x <= weightFactor; x++) {
          rankedNodes.push(rawNodes[sortedLog.nodePublicKey]);
        }
        weightFactor = weightFactor - 2;
      }
      else if (sortedLog.successRate > 0.95) {
        // For all nodes with reasonable success rate, weight their selection less
        for (let x=1; x <= weightFactor; x++) {
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
    if (this.checkDebug()) {
      console.log("Number of weighted nodes for selection: " + rankedNodes.length);
      console.log("Selected "+ selectedNode + " : " + node.publicKey);
    }
    return node;
  }
}
