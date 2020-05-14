import {inject} from '@loopback/context';
import {
  FilterExcludingWhere,
  repository,
} from '@loopback/repository';
import {
  post,
  param,
  requestBody,
  HttpErrors
} from '@loopback/rest';
import {PocketApplication} from '../models';
import {PocketApplicationRepository} from '../repositories';
import {
  Pocket, 
  PocketAAT, 
  RpcError, 
  ConsensusNode, 
  RelayResponse
} from '@pokt-network/pocket-js';
import {Redis} from 'ioredis';

export class V1Controller {
  constructor(
    @inject('secretKey') private secretKey: string,
    @inject('blockchain') private blockchain: string,
    @inject('origin') private origin: string,
    @inject('userAgent') private userAgent: string,
    @inject('pocketInstance') private pocket: Pocket,
    @inject('redisInstance') private redis: Redis,
    @repository(PocketApplicationRepository) public pocketApplicationRepository : PocketApplicationRepository,
  ) {}

  @post('/v1/{id}', {
    responses: {
      '200': {
        description: 'Relay Response',
        content: {
          'application/json': {
          },
        },
      },
    },
  })
  async attemptRelay(
    @param.path.string('id') id: string,
    @requestBody() data: any,
    @param.filter(PocketApplication, {exclude: 'where'}) filter?: FilterExcludingWhere<PocketApplication>
  ): Promise<string> {
    console.log("PROCESSING " + id +  " chain: " + this.blockchain +" req: " + JSON.stringify(data))

    // Construct Pocket AAT from cache; if not available, use the db
    const cachedApp = await this.redis.get(id);
    let app;

    if (!cachedApp) {
      app = await this.pocketApplicationRepository.findById(id, filter);
      this.redis.set(id, JSON.stringify(app), "EX", 60);
    }
    else {
      app = JSON.parse(cachedApp);
    }

    // Check secretKey; is it required? does it pass?
    if (app.secretKeyRequired && this.secretKey !== app.secretKey) {
      throw new HttpErrors.Forbidden("SecretKey does not match");
    }

    // Whitelist: origins -- explicit matches
    if (!this.checkWhitelist(app.whitelistOrigins, this.origin, "explicit")) {
      throw new HttpErrors.Forbidden("Whitelist Origin check failed: " + this.origin);
    }

    // Whitelist: userAgent -- substring matches
    if (!this.checkWhitelist(app.whitelistUserAgents, this.userAgent, "substring")) {
      throw new HttpErrors.Forbidden("Whitelist User Agent check failed: " + this.userAgent);
    }
    
    // Whitelist: contracts

    // Checks pass; create AAT from db record
    const pocketAAT = new PocketAAT(
      app.version,
      app.clientPubKey,
      app.appPubKey,
      app.signature
    )

    // Check the requested blockchain, override if passed in the body
    const blockchainRegex = /^[A-Fa-f0-9]{4}$/;
    if (data.blockchain && blockchainRegex.test(data.blockchain)) {
      this.blockchain = data.blockchain;
    }

    // Send relay and process return: RelayResponse, RpcError, ConsensusNode, or undefined
    const relayResponse = await this.pocket.sendRelay(JSON.stringify(data), this.blockchain, pocketAAT);
    
    // Success
    if (relayResponse instanceof RelayResponse) {
      console.log("SUCCESS " + id +  " chain: " + this.blockchain +" req: " + JSON.stringify(data) + " res: " + relayResponse.payload)
      return relayResponse.payload;
    } 
    // Error
    else if (relayResponse instanceof RpcError) {
      console.log("ERROR " + id +  " chain: " + this.blockchain +" req: " + JSON.stringify(data) + " res: " + relayResponse.message);
      throw new HttpErrors.InternalServerError(relayResponse.message);
    } 
    // ConsensusNode
    else {
      // TODO: ConsensusNode is a possible return
      throw new HttpErrors.InternalServerError("relayResponse is undefined");
    }
  }

  checkWhitelist(tests: string[], check: string, type: string): boolean {
    if (tests.length === 0) { return true; }
    if (!check) { return false; }

    for (var test of tests) {
      if (type === "explicit"){
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
