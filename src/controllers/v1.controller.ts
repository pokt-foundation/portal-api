import {inject} from '@loopback/context';
import {
  Count,
  CountSchema,
  Filter,
  FilterExcludingWhere,
  repository,
  Where,
} from '@loopback/repository';
import {
  post,
  param,
  get,
  getModelSchemaRef,
  requestBody,
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

export class V1Controller {
  constructor(
    @inject('secretKey') private secretKey: string,
    @inject('blockchain') private blockchain: string,
    @inject('origin') private origin: string,
    @inject('userAgent') private userAgent: string,
    @inject('pocketInstance') private pocketInstance: Pocket,
    @repository(PocketApplicationRepository) public pocketApplicationRepository : PocketApplicationRepository,
  ) {}

  @post('/app', {
    responses: {
      '200': {
        description: 'PocketApplication model instance',
        content: {'application/json': {schema: getModelSchemaRef(PocketApplication)}},
      },
    },
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(PocketApplication, {
            title: 'NewPocketApplication',
            
          }),
        },
      },
    })
    pocketApplication: PocketApplication,
  ): Promise<PocketApplication> {
    console.log(getModelSchemaRef(PocketApplication));
    return this.pocketApplicationRepository.create(PocketApplication);
  }

  @get('/apps/count', {
    responses: {
      '200': {
        description: 'PocketApplication model count',
        content: {'application/json': {schema: CountSchema}},
      },
    },
  })
  async count(
    @param.where(PocketApplication) where?: Where<PocketApplication>,
  ): Promise<Count> {
    return this.pocketApplicationRepository.count(where);
  }

  @get('/apps', {
    responses: {
      '200': {
        description: 'Array of PocketApplication model instances',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: getModelSchemaRef(PocketApplication, {includeRelations: true}),
            },
          },
        },
      },
    },
  })
  async find(
    @param.filter(PocketApplication) filter?: Filter<PocketApplication>,
  ): Promise<PocketApplication[]> {
    return this.pocketApplicationRepository.find(filter);
  }

  @get('/v1/{id}', {
    responses: {
      '200': {
        description: 'PocketApplication model instance',
        content: {
          'application/json': {
            schema: getModelSchemaRef(PocketApplication, {includeRelations: true}),
          },
        },
      },
    },
  })
  async findById(
    @param.path.string('id') id: string,
    @param.filter(PocketApplication, {exclude: 'where'}) filter?: FilterExcludingWhere<PocketApplication>
  ): Promise<PocketApplication> {
    return this.pocketApplicationRepository.findById(id, filter);
  }

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

    // Construct Pocket AAT from the db record
    const app = await this.pocketApplicationRepository.findById(id, filter);

    // Check secretKey; is it required? does it pass?
    if (app.secretKeyRequired && this.secretKey !== app.secretKey) {
      throw new Error("SecretKey does not match");
    }

    // Whitelist: origins -- explicit matches
    if (!this.checkWhitelist(app.whitelistOrigins, this.origin, "explicit")) {
      throw new Error("Whitelist Origin check failed " + this.origin);
    }

    // Whitelist: userAgent -- substring matches
    if (!this.checkWhitelist(app.whitelistUserAgents, this.userAgent, "substring")) {
      throw new Error("Whitelist User Agent check failed " + this.userAgent);
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
    const relayResponse = await this.pocketInstance.sendRelay(JSON.stringify(data), this.blockchain, pocketAAT);
    
    // Success
    if (relayResponse instanceof RelayResponse) {
      console.log("SUCCESS " + id +  " chain: " + this.blockchain +" req: " + JSON.stringify(data) + " res: " + relayResponse.payload)
      return relayResponse.payload;
    } 
    // Error
    else if (relayResponse instanceof RpcError) {
      console.log("ERROR " + id +  " chain: " + this.blockchain +" req: " + JSON.stringify(data) + " res: " + relayResponse.message);
      return relayResponse.message;
    } 
    // ConsensusNode
    else {
      // TODO: ConsensusNode is a possible return
      throw new Error("relayResponse is undefined");
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
