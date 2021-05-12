import {CherryPicker} from '../services/cherry-picker';
import {MetricsRecorder} from '../services/metrics-recorder';
import {SyncChecker} from '../services/sync-checker';
import {Decryptor} from 'strong-cryptor';
import {HttpErrors} from '@loopback/rest';
import {
  PocketAAT,
  Session,
  RelayResponse,
  Pocket,
  Configuration,
  RpcError,
  HttpRpcProvider,
  HTTPMethod,
  Node,
} from '@pokt-network/pocket-js';
import {Redis} from 'ioredis';
import {BlockchainsRepository} from '../repositories';
import {Applications} from '../models';
import {RelayError} from '../errors/relay-error';

const logger = require('../services/logger');

interface FallbackRelay { payload: FallbackPayload; meta: FallbackMeta; proof: FallbackProof };
interface FallbackPayload { data: String; method: String; path: String; headers: null };
interface FallbackMeta { block_height: number } ;
interface FallbackProof { blockchain: String };

export class PocketRelayer {
  host: string;
  origin: string;
  userAgent: string;
  pocket: Pocket;
  pocketConfiguration: Configuration;
  cherryPicker: CherryPicker;
  metricsRecorder: MetricsRecorder;
  syncChecker: SyncChecker;
  redis: Redis;
  databaseEncryptionKey: string;
  secretKey: string;
  relayRetries: number;
  blockchainsRepository: BlockchainsRepository;
  checkDebug: boolean;
  fallbacks: Array<URL>;

  constructor({
    host,
    origin,
    userAgent,
    pocket,
    pocketConfiguration,
    cherryPicker,
    metricsRecorder,
    syncChecker,
    redis,
    databaseEncryptionKey,
    secretKey,
    relayRetries,
    blockchainsRepository,
    checkDebug,
    fallbackURL,
  }: {
    host: string;
    origin: string;
    userAgent: string;
    pocket: Pocket;
    pocketConfiguration: Configuration;
    cherryPicker: CherryPicker;
    metricsRecorder: MetricsRecorder;
    syncChecker: SyncChecker;
    redis: Redis;
    databaseEncryptionKey: string;
    secretKey: string;
    relayRetries: number;
    blockchainsRepository: BlockchainsRepository;
    checkDebug: boolean;
    fallbackURL: string;
  }) {
    this.host = host;
    this.origin = origin;
    this.userAgent = userAgent;
    this.pocket = pocket;
    this.pocketConfiguration = pocketConfiguration;
    this.cherryPicker = cherryPicker;
    this.metricsRecorder = metricsRecorder;
    this.syncChecker = syncChecker;
    this.redis = redis;
    this.databaseEncryptionKey = databaseEncryptionKey;
    this.secretKey = secretKey;
    this.relayRetries = relayRetries;
    this.blockchainsRepository = blockchainsRepository;
    this.checkDebug = checkDebug;
    
    // Create the array of fallback relayers as last resort
    const fallbacks = [];

    if (fallbackURL.indexOf(",")) {
      const fallbackArray = fallbackURL.split(",");
      fallbackArray.forEach(function(fallback) {
        fallbacks.push(new URL(fallback));
      });
    } else {
      fallbacks.push(new URL(fallbackURL));
    }
    this.fallbacks = fallbacks;
  }

  async sendRelay(
    rawData: object,
    relayPath: string,
    httpMethod: HTTPMethod,
    application: Applications,
    requestID: string,
    requestTimeOut?: number,
    overallTimeOut?: number, 
    relayRetries?: number
  ): Promise<string | Error> {
    if (
      relayRetries !== undefined &&
      relayRetries >= 0
      ) {
      this.relayRetries = relayRetries;
    }
    const [blockchain, blockchainEnforceResult, blockchainSyncCheck] = await this.loadBlockchain();
    const overallStart = process.hrtime();

    // This converts the raw data into formatted JSON then back to a string for relaying.
    // This allows us to take in both [{},{}] arrays of JSON and plain JSON and removes
    // extraneous characters like newlines and tabs from the rawData.
    // Normally the arrays of JSON do not pass the AJV validation used by Loopback.
    const parsedRawData = JSON.parse(rawData.toString());
    const data = JSON.stringify(parsedRawData);
    const method = this.parseMethod(parsedRawData);
    const fallbackAvailable = (this.fallbacks.length > 0 && this.pocket !== undefined) ? true : false;

    // Retries if applicable
    for (let x = 0; x <= this.relayRetries; x++) { 
      let relayStart = process.hrtime();
      
      // Compute the overall time taken on this LB request
      const overallCurrent = process.hrtime(overallStart);
      const overallCurrentElasped = Math.round((overallCurrent[0] * 1e9 + overallCurrent[1]) / 1e6);
      if (
          overallTimeOut &&
          overallCurrentElasped > overallTimeOut
        ) {
        logger.log('error', 'Overall Timeout exceeded: ' + overallTimeOut, {requestID: requestID, relayType: 'APP', typeID: application.id, serviceNode: ''});
        return new HttpErrors.GatewayTimeout('Overall Timeout exceeded: ' + overallTimeOut);
      }
      
      // Send this relay attempt
      const relayResponse = await this._sendRelay(data, relayPath, httpMethod, requestID, application, requestTimeOut, blockchain, blockchainEnforceResult, blockchainSyncCheck);
      
      if (!(relayResponse instanceof Error)) {
        // Record success metric
        await this.metricsRecorder.recordMetric({
          requestID: requestID,
          applicationID: application.id,
          appPubKey: application.gatewayAAT.applicationPublicKey,
          blockchain,
          serviceNode: relayResponse.proof.servicerPubKey,
          relayStart,
          result: 200,
          bytes: Buffer.byteLength(relayResponse.payload, 'utf8'),
          delivered: false,
          fallback: false,
          method: method,
          error: undefined
        });
        
        // Clear error log
        await this.redis.del(blockchain + '-' + relayResponse.proof.servicerPubKey + '-errors');

        // If return payload is valid JSON, turn it into an object so it is sent with content-type: json
        if (
          blockchainEnforceResult && // Is this blockchain marked for result enforcement // and
          blockchainEnforceResult.toLowerCase() === 'json' // the check is for JSON
        ) {
          return JSON.parse(relayResponse.payload);
        }
        return relayResponse.payload;
      } else if (relayResponse instanceof RelayError) {
        // Record failure metric, retry if possible or fallback
        // If this is the last retry and fallback is available, mark the error not delivered
        const errorDelivered = (x === this.relayRetries && fallbackAvailable) ? false : true;

        // Increment error log
        await this.redis.incr(blockchain + '-' + relayResponse.servicer_node + '-errors');
        await this.redis.expire(blockchain + '-' + relayResponse.servicer_node + '-errors', 3600);

        let error = relayResponse.message;
        if (typeof relayResponse.message === 'object') {
          error = JSON.stringify(relayResponse.message);
        }

        await this.metricsRecorder.recordMetric({
          requestID,
          applicationID: application.id,
          appPubKey: application.gatewayAAT.applicationPublicKey,
          blockchain,
          serviceNode: relayResponse.servicer_node,
          relayStart,
          result: 500,
          bytes: Buffer.byteLength(relayResponse.message, 'utf8'),
          delivered: errorDelivered,
          fallback: false,
          method,
          error,
        });
      }
    }
    // Exhausted relay attempts; use fallback
    if (fallbackAvailable) {      
      let relayStart = process.hrtime();

      const fallbackChoice = new HttpRpcProvider(this.fallbacks[Math.floor(Math.random() * this.fallbacks.length)]);
      const fallbackPayload : FallbackPayload = {data: rawData.toString(), method: httpMethod, path: relayPath,  headers: null};
      const fallbackMeta: FallbackMeta = {block_height: 0};
      const fallbackProof: FallbackProof = {blockchain: blockchain};
      const fallbackRelay: FallbackRelay = {payload: fallbackPayload, meta: fallbackMeta, proof: fallbackProof};

      const fallbackResponse = await fallbackChoice.send("/v1/client/relay", JSON.stringify(fallbackRelay), 1200000, false);
      
      if (this.checkDebug) {
        logger.log('debug', JSON.stringify(fallbackChoice), {requestID: requestID, relayType: 'FALLBACK', typeID: application.id, serviceNode: 'fallback:'+fallbackChoice.baseURL});
        logger.log('debug', JSON.stringify(fallbackRelay), {requestID: requestID, relayType: 'FALLBACK', typeID: application.id, serviceNode: 'fallback:'+fallbackChoice.baseURL});
        logger.log('debug', JSON.stringify(fallbackResponse), {requestID: requestID, relayType: 'FALLBACK', typeID: application.id, serviceNode: 'fallback:'+fallbackChoice.baseURL});
      }
      if (!(fallbackResponse instanceof RpcError)) {
        const responseParsed = JSON.parse(fallbackResponse);

        await this.metricsRecorder.recordMetric({
          requestID: requestID,
          applicationID: application.id,
          appPubKey: application.gatewayAAT.applicationPublicKey,
          blockchain,
          serviceNode: "fallback:"+fallbackChoice.baseURL,
          relayStart,
          result: 200,
          bytes: Buffer.byteLength(responseParsed.response, 'utf8'),
          delivered: false,
          fallback: true,
          method: method,
          error: undefined
        });
        // If return payload is valid JSON, turn it into an object so it is sent with content-type: json
        if (
          blockchainEnforceResult && // Is this blockchain marked for result enforcement // and
          blockchainEnforceResult.toLowerCase() === 'json' // the check is for JSON
        ) {
          return JSON.parse(responseParsed.response);
        }
        else {
          return responseParsed.response;
        }
      }
      else {
        logger.log('error', JSON.stringify(fallbackResponse), {requestID: requestID, relayType: 'FALLBACK', typeID: application.id, serviceNode: 'fallback:'+fallbackChoice.baseURL});
      }
    }
    return new HttpErrors.GatewayTimeout('Relay attempts exhausted');
  }

  // Private function to allow relay retries
  async _sendRelay(
    data: string,
    relayPath: string,
    httpMethod: HTTPMethod,
    requestID: string,
    application: Applications,
    requestTimeOut: number | undefined,
    blockchain: string,
    blockchainEnforceResult: string,
    blockchainSyncCheck: string,
  ): Promise<RelayResponse | Error> {
    logger.log('info', 'RELAYING ' + blockchain + ' req: ' + data, {requestID: requestID, relayType: 'APP', typeID: application.id, serviceNode: ''});
    
    // Secret key check
    if (!this.checkSecretKey(application)) {
      throw new HttpErrors.Forbidden('SecretKey does not match');
    }

    // Whitelist: origins -- explicit matches
    if (
      !this.checkWhitelist(
        application.gatewaySettings.whitelistOrigins,
        this.origin,
        'explicit',
      )
    ) {
      throw new HttpErrors.Forbidden(
        'Whitelist Origin check failed: ' + this.origin,
      );
    }

    // Whitelist: userAgent -- substring matches
    if (
      !this.checkWhitelist(
        application.gatewaySettings.whitelistUserAgents,
        this.userAgent,
        'substring',
      )
    ) {
      throw new HttpErrors.Forbidden(
        'Whitelist User Agent check failed: ' + this.userAgent,
      );
    }

    // Checks pass; create AAT
    const pocketAAT = new PocketAAT(
      application.gatewayAAT.version,
      application.gatewayAAT.clientPublicKey,
      application.gatewayAAT.applicationPublicKey,
      application.gatewayAAT.applicationSignature,
    );

    let node;

    // Pull the session so we can get a list of nodes and cherry pick which one to use
    const pocketSession = await this.pocket.sessionManager.getCurrentSession(
      pocketAAT,
      blockchain,
      this.pocketConfiguration,
    );
    if (pocketSession instanceof Session) {
      let nodes: Node[] = pocketSession.sessionNodes;
      if (blockchainSyncCheck) {
        nodes = await this.syncChecker.consensusFilter(pocketSession.sessionNodes, requestID, blockchainSyncCheck, 2, blockchain, application.id, application.gatewayAAT.applicationPublicKey, this.pocket, pocketAAT, this.pocketConfiguration);
      }           
      node = await this.cherryPicker.cherryPickNode(application, nodes, blockchain, requestID);
    }

    if (this.checkDebug) {
      logger.log('debug', JSON.stringify(pocketSession), {requestID: requestID, relayType: 'APP', typeID: application.id, serviceNode: node?.publicKey});
    }

    // Adjust Pocket Configuration for a custom requestTimeOut
    let relayConfiguration = this.pocketConfiguration;
    if (requestTimeOut) {
      relayConfiguration = this.updateConfiguration(requestTimeOut);
    }
    
    // Send relay and process return: RelayResponse, RpcError, ConsensusNode, or undefined
    const relayResponse = await this.pocket.sendRelay(
      data,
      blockchain,
      pocketAAT,
      relayConfiguration,
      undefined,
      httpMethod,
      relayPath,
      node,
      undefined,
      requestID,
    );

    if (this.checkDebug) {
      logger.log('debug', JSON.stringify(relayConfiguration), {requestID: requestID, relayType: 'APP', typeID: application.id, serviceNode: node?.publicKey});
      logger.log('debug', JSON.stringify(relayResponse), {requestID: requestID, relayType: 'APP', typeID: application.id, serviceNode: node?.publicKey});
    }

    // Success
    if (relayResponse instanceof RelayResponse) {
      // First, check for the format of the result; Pocket Nodes will return relays that include
      // erroneous results like "invalid host specified" when the node is configured incorrectly.
      // Those results are still marked as 200:success.
      // To filter them out, we will enforce result formats on certain blockchains. If the
      // relay result is not in the correct format, this was not a successful relay.
      if (
        blockchainEnforceResult && // Is this blockchain marked for result enforcement // and
        blockchainEnforceResult.toLowerCase() === 'json' && // the check is for JSON // and
        (
          !this.checkEnforcementJSON(relayResponse.payload) || // the relay response is not valid JSON // or 
          relayResponse.payload.startsWith('{"error"') // the full payload is an error
        )
      ) {
        // then this result is invalid
        return new RelayError(relayResponse.payload, 503, relayResponse.proof.servicerPubKey);
      } else {
        // Success
        return relayResponse;
      }
    }
    // Error
    else if (relayResponse instanceof Error) {
      return new RelayError(relayResponse.message, 500, node?.publicKey);
    }
    // ConsensusNode
    else {
      // TODO: ConsensusNode is a possible return
      return new Error('relayResponse is undefined');
    }
  }

  // Fetch node client type if Ethereum based
  async fetchClientTypeLog(
    blockchain: string,
    id: string | undefined,
  ): Promise<string | null> {
    const clientTypeLog = await this.redis.get(
      blockchain + '-' + id + '-clientType',
    );
    return clientTypeLog;
  }

  parseMethod(parsedRawData: any) {
    // Method recording for metrics
    let method = "";
    if (parsedRawData instanceof Array) {
      // Join the methods of calls in an array for chains that can join multiple calls in one
      for (const key in parsedRawData) {
        if (parsedRawData[key].method) {
          if (method) {
            method += ',';
          }
          method += parsedRawData[key].method;
        }
      }
    } else if (parsedRawData.method) {
      method = parsedRawData.method;
    }
    return method;
  }

  updateConfiguration(requestTimeOut: number) {
    return new Configuration(
      this.pocketConfiguration.maxDispatchers,
      this.pocketConfiguration.maxSessions,
      this.pocketConfiguration.consensusNodeCount,
      requestTimeOut,
      this.pocketConfiguration.acceptDisputedResponses,
      this.pocketConfiguration.sessionBlockFrequency,
      this.pocketConfiguration.blockTime,
      this.pocketConfiguration.maxSessionRefreshRetries,
      this.pocketConfiguration.validateRelayResponses,
      this.pocketConfiguration.rejectSelfSignedCertificates
    );
  }

  // Load requested blockchain by parsing the URL
  async loadBlockchain(): Promise<string[]> {
    // Load the requested blockchain
    const cachedBlockchains = await this.redis.get('blockchains');
    let blockchains;

    if (!cachedBlockchains) {
      blockchains = await this.blockchainsRepository.find();
      await this.redis.set('blockchains', JSON.stringify(blockchains), 'EX', 1);
    } else {
      blockchains = JSON.parse(cachedBlockchains);
    }

    // Split off the first part of the request's host and check for matches
    const blockchainRequest = this.host.split('.')[0];
    const blockchainFilter = blockchains.filter(
      (b: {blockchain: string}) =>
        b.blockchain.toLowerCase() === blockchainRequest.toLowerCase(),
    );

    if (blockchainFilter[0]) {
      let blockchainEnforceResult = '';
      let blockchainSyncCheck = '';
      const blockchain = blockchainFilter[0].hash as string;
      
      // Record the necessary format for the result; example: JSON
      if (blockchainFilter[0].enforceResult) {
        blockchainEnforceResult = blockchainFilter[0].enforceResult;
      }
      // Sync Check to determine current blockheight
      if (blockchainFilter[0].syncCheck) {
        blockchainSyncCheck = blockchainFilter[0].syncCheck.replace(/\\"/g, '"');
      }
      return Promise.resolve([blockchain, blockchainEnforceResult, blockchainSyncCheck]);
    } else {
      throw new HttpErrors.BadRequest('Incorrect blockchain: ' + this.host);
    }
  }

  // Check relay result: JSON
  checkEnforcementJSON(test: string): boolean {
    if (!test || test.length === 0) {
      return false;
    }
    // Code from: https://github.com/prototypejs/prototype/blob/560bb59414fc9343ce85429b91b1e1b82fdc6812/src/prototype/lang/string.js#L699
    // Prototype lib
    if (/^\s*$/.test(test)) return false;
    test = test.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '@');
    test = test.replace(
      /"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,
      ']',
    );
    test = test.replace(/(?:^|:|,)(?:\s*\[)+/g, '');
    return /^[\],:{}\s]*$/.test(test);
  }

  checkSecretKey(application: Applications): boolean {
    // Check secretKey; is it required? does it pass? -- temp allowance for unencrypted keys
    const decryptor = new Decryptor({key: this.databaseEncryptionKey});
    if (
      application.gatewaySettings.secretKeyRequired && // If the secret key is required by app's settings // and
      application.gatewaySettings.secretKey && // the app's secret key is set // and
      (!this.secretKey || // the request doesn't contain a secret key // or
        this.secretKey.length < 32 || // the secret key is invalid // or
        (this.secretKey.length === 32 &&
          this.secretKey !== application.gatewaySettings.secretKey) || // the secret key does not match plaintext // or
        (this.secretKey.length > 32 &&
          this.secretKey !==
            decryptor.decrypt(application.gatewaySettings.secretKey))) // does not match encrypted
    ) {
      return false;
    }
    return true;
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
      if (type === 'explicit') {
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
