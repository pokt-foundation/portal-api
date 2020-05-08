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
import {Aat} from '../models';
import {AatRepository} from '../repositories';
import {Pocket, PocketAAT, Configuration, HttpRpcProvider, RpcError, ConsensusNode, RelayResponse} from '@pokt-network/pocket-js';

export class V1Controller {
  constructor(
    @inject('secretKey') private secretKey: string,
    @inject('blockchain') private blockchain: string,
    @repository(AatRepository) public aatRepository : AatRepository,
  ) {}

  @post('/aat', {
    responses: {
      '200': {
        description: 'Aat model instance',
        content: {'application/json': {schema: getModelSchemaRef(Aat)}},
      },
    },
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Aat, {
            title: 'NewAat',
            
          }),
        },
      },
    })
    aat: Aat,
  ): Promise<Aat> {
    return this.aatRepository.create(aat);
  }

  @get('/aats/count', {
    responses: {
      '200': {
        description: 'Aat model count',
        content: {'application/json': {schema: CountSchema}},
      },
    },
  })
  async count(
    @param.where(Aat) where?: Where<Aat>,
  ): Promise<Count> {
    return this.aatRepository.count(where);
  }

  @get('/aats', {
    responses: {
      '200': {
        description: 'Array of Aat model instances',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: getModelSchemaRef(Aat, {includeRelations: true}),
            },
          },
        },
      },
    },
  })
  async find(
    @param.filter(Aat) filter?: Filter<Aat>,
  ): Promise<Aat[]> {
    return this.aatRepository.find(filter);
  }

  @get('/v1/{id}', {
    responses: {
      '200': {
        description: 'Aat model instance',
        content: {
          'application/json': {
            schema: getModelSchemaRef(Aat, {includeRelations: true}),
          },
        },
      },
    },
  })
  async findById(
    @param.path.string('id') id: string,
    @param.filter(Aat, {exclude: 'where'}) filter?: FilterExcludingWhere<Aat>
  ): Promise<Aat> {
    return this.aatRepository.findById(id, filter);
  }

  @post('/v1/{id}', {
    responses: {
      '200': {
        description: 'Aat model instance',
        content: {
          'application/json': {
            schema: getModelSchemaRef(Aat, {includeRelations: true}),
          },
        },
      },
    },
  })
  async attemptRelay(
    @param.path.string('id') id: string,
    @requestBody() data: any,
    @param.filter(Aat, {exclude: 'where'}) filter?: FilterExcludingWhere<Aat>
  ): Promise<string> {

    // Construct Pocket AAT from the db record
    const aatRecord = await this.aatRepository.findById(id, filter);

    // Check secretKey; is it required? does it pass?
    // if (secretKey.required)...
    if (this.secretKey !== aatRecord.secretKey)
    {
      throw new Error("SecretKey does not match");
    }

    // Checks pass; create AAT from db record
    const pocketAAT = new PocketAAT(
      aatRecord.version,
      aatRecord.clientPubKey,
      aatRecord.appPubKey,
      aatRecord.signature
    )

    // Check the requested blockchain, override if passed in the body
    const blockchainRegex = /^[A-Fa-f0-9]{4}$/;
    if (data.blockchain && blockchainRegex.test(data.blockchain)) {
      this.blockchain = data.blockchain;
    }
    // console.log("Requesting blockchain:", this.blockchain);

    // Create dispatch
    // TODO: caching? per app?
    const dispatchers = new URL("http://localhost:8081");
    const configuration = new Configuration(5, 1000, 5, 40000,true);
    const rpcProvider = new HttpRpcProvider(dispatchers)
    const pocket = new Pocket([dispatchers],rpcProvider,configuration);
 
    // Unlock primary client account for relay signing
    const clientPrivKey = 'd561ca942e974c541d4999fe2c647f238c22eb42441a472989d2a18a5437a9cfc4553f77697e2dc51ae2b2a7460821dcde8ca876a1b602d13501d9d37584ddfc'
    const importAcct = await pocket.keybase.importAccount(Buffer.from(clientPrivKey, 'hex'), 'pocket');
    const unlockAcct =  await pocket.keybase.unlockAccount('d0092305fa8ebf9a97a61d007b878a7840f51900', 'pocket', 0);

    // Send relay and process return: RelayResponse, ConsensusNode, or undefined
    const relayResponse = await pocket.sendRelay(JSON.stringify(data), this.blockchain, pocketAAT, configuration);
    
    // Success
    if (relayResponse instanceof RelayResponse) {
      return relayResponse.payload;
    } 
    // Error
    else if (relayResponse instanceof RpcError) {
      console.log("ERROR", relayResponse.message);
      return relayResponse.message;
    } 
    // ConsensusNode
    else {
      // TODO: ConsensusNode is a possible return
      throw new Error("relayResponse is undefined");
    }
  }
}
