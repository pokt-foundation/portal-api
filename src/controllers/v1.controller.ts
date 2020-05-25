import { inject } from "@loopback/context";
import { FilterExcludingWhere, repository } from "@loopback/repository";
import { post, param, requestBody, HttpErrors } from "@loopback/rest";
import { PocketApplication } from "../models";
import {
  PocketApplicationRepository,
  BlockchainRepository,
} from "../repositories";
import {
  Pocket,
  PocketAAT,
  RpcError,
  Configuration,
  Session,
  Node,
  ConsensusNode,
  RelayResponse,
} from "@pokt-network/pocket-js";
import { Redis } from "ioredis";
import { Pool as PGPool } from "pg";
var pgFormat = require("pg-format");

export class V1Controller {
  constructor(
    @inject("secretKey") private secretKey: string,
    @inject("host") private host: string,
    @inject("origin") private origin: string,
    @inject("userAgent") private userAgent: string,
    @inject("pocketInstance") private pocket: Pocket,
    @inject("pocketConfiguration") private pocketConfiguration: Configuration,
    @inject("redisInstance") private redis: Redis,
    @inject("pgPool") private pgPool: PGPool,
    @inject("processUID") private processUID: string,
    @repository(PocketApplicationRepository)
    public pocketApplicationRepository: PocketApplicationRepository,
    @repository(BlockchainRepository)
    private blockchainRepository: BlockchainRepository
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
    @requestBody() data: any,
    @param.filter(PocketApplication, { exclude: "where" })
    filter?: FilterExcludingWhere<PocketApplication>
  ): Promise<string> {
    console.log("PROCESSING " + id + " host: " + this.host + " req: " + JSON.stringify(data));
    const elapsedStart = process.hrtime();

    // Load the requested blockchain
    const cachedBlockchains = await this.redis.get("blockchains");
    let blockchains, blockchain;

    if (!cachedBlockchains) {
      blockchains = await this.blockchainRepository.find();
      this.redis.set("blockchains", JSON.stringify(blockchains), "EX", 1);
    } else {
      blockchains = JSON.parse(cachedBlockchains);
    }

    // Split off the first part of the request's host and check for matches
    const blockchainRequest = this.host.split(".")[0];
    const blockchainFilter = blockchains.filter(
      (b: any) => b.blockchain.toLowerCase() === blockchainRequest.toLowerCase()
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
      app = await this.pocketApplicationRepository.findById(id, filter);
      this.redis.set(id, JSON.stringify(app), "EX", 60);
    } else {
      app = JSON.parse(cachedApp);
    }

    // Check secretKey; is it required? does it pass?
    if (app.secretKeyRequired && this.secretKey !== app.secretKey) {
      throw new HttpErrors.Forbidden("SecretKey does not match");
    }

    // Whitelist: origins -- explicit matches
    if (!this.checkWhitelist(app.whitelistOrigins, this.origin, "explicit")) {
      throw new HttpErrors.Forbidden(
        "Whitelist Origin check failed: " + this.origin
      );
    }

    // Whitelist: userAgent -- substring matches
    if (
      !this.checkWhitelist(app.whitelistUserAgents, this.userAgent, "substring")
    ) {
      throw new HttpErrors.Forbidden(
        "Whitelist User Agent check failed: " + this.userAgent
      );
    }

    // Checks pass; create AAT from db record
    const pocketAAT = new PocketAAT(
      app.version,
      app.clientPubKey,
      app.appPubKey,
      app.signature
    );

    // Pull a specific node for this relay
    let node;
    const pocketSession = await this.pocket.sessionManager.getCurrentSession(
      pocketAAT,
      blockchain,
      this.pocketConfiguration
    );
    if (pocketSession instanceof Session) {
      /*
      pocketSession.sessionNodes.forEach(function (node, index) {
        console.log(node.publicKey + " - " + node.serviceURL.hostname);
      });
      */
      node =
        pocketSession.sessionNodes[
          Math.floor(Math.random() * pocketSession.sessionNodes.length)
        ];
      // console.log("CHOSEN: " + node.publicKey);
    }
    // Send relay and process return: RelayResponse, RpcError, ConsensusNode, or undefined
    const relayResponse = await this.pocket.sendRelay(
      JSON.stringify(data),
      blockchain,
      pocketAAT,
      this.pocketConfiguration,
      undefined,
      undefined,
      undefined,
      node
    );

    // Success
    if (relayResponse instanceof RelayResponse) {
      console.log("SUCCESS " + id + " chain: " + blockchain + " req: " + JSON.stringify(data) + " res: " + relayResponse.payload);
      const bytes = Buffer.byteLength(relayResponse.payload, 'utf8');

      this.recordMetric({
        appPubKey: app.appPubKey,
        blockchain,
        serviceNode: relayResponse.proof.servicePubKey,
        elapsedStart,
        result: 200,
        bytes,
      });
      return relayResponse.payload;
    }
    // Error
    else if (relayResponse instanceof RpcError) {
      console.log("ERROR " + id + " chain: " + blockchain + " req: " + JSON.stringify(data) + " res: " + relayResponse.message);
      console.log(relayResponse);
      const bytes = Buffer.byteLength(relayResponse.message, 'utf8');

      this.recordMetric({
        appPubKey: app.appPubKey,
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
      const redisTimestamp = Math.floor(new Date().getTime() / 1000);

      // List has been started in redis and needs to be pushed as timestamp is > 10 seconds old
      if (
        redisListAge &&
        redisListSize > 0 &&
        redisTimestamp > parseInt(redisListAge) + 10
      ) {
        let bulkData = [];
        for (let count = 0; count < redisListSize; count++) {
          const redisRecord = await this.redis.lpop(redisMetricsKey);
          bulkData.push(JSON.parse(redisRecord));
        }

        const metricsQuery = pgFormat(
          "INSERT INTO relay VALUES %L RETURNING *",
          bulkData
        );
        this.pgPool.query(metricsQuery);

        await this.redis.unlink("age-" + redisMetricsKey);
      } else if (!redisListAge) {
        await this.redis.set("age-" + redisMetricsKey, redisTimestamp);
      }

      this.redis.rpush(redisMetricsKey, JSON.stringify(metricsValues));
    } catch (err) {
      console.log(err.stack);
    }
  }

  checkWhitelist(tests: string[], check: string, type: string): boolean {
    if (tests.length === 0) {
      return true;
    }
    if (!check) {
      return false;
    }

    for (var test of tests) {
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
}
