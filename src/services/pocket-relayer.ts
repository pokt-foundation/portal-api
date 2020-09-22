import {CherryPicker} from '../services/cherry-picker';
import {MetricsRecorder} from '../services/metrics-recorder';
import {Decryptor} from 'strong-cryptor';
import {HttpErrors} from '@loopback/rest';
import {
  PocketAAT,
  Session,
  RelayResponse,
  Pocket,
  Configuration,
  RpcError,
} from '@pokt-network/pocket-js';
import {Redis} from 'ioredis';
import {BlockchainsRepository} from '../repositories';
import {Applications} from '../models';

export class PocketRelayer {
  host: string;
  origin: string;
  userAgent: string;
  pocket: Pocket;
  pocketConfiguration: Configuration;
  cherryPicker: CherryPicker;
  metricsRecorder: MetricsRecorder;
  redis: Redis;
  databaseEncryptionKey: string;
  secretKey: string;
  relayPath: string;
  relayRetries: number;
  checkDebug: boolean;
  blockchainsRepository: BlockchainsRepository;

  constructor({
    host,
    origin,
    userAgent,
    pocket,
    pocketConfiguration,
    cherryPicker,
    metricsRecorder,
    redis,
    databaseEncryptionKey,
    secretKey,
    relayPath,
    relayRetries,
    blockchainsRepository,
    checkDebug,
  }: {
    host: string;
    origin: string;
    userAgent: string;
    pocket: Pocket;
    pocketConfiguration: Configuration;
    cherryPicker: CherryPicker;
    metricsRecorder: MetricsRecorder;
    redis: Redis;
    databaseEncryptionKey: string;
    secretKey: string;
    relayPath: string;
    relayRetries: number;
    blockchainsRepository: BlockchainsRepository;
    checkDebug: boolean;
  }) {
    this.host = host;
    this.origin = origin;
    this.userAgent = userAgent;
    this.pocket = pocket;
    this.pocketConfiguration = pocketConfiguration;
    this.cherryPicker = cherryPicker;
    this.metricsRecorder = metricsRecorder;
    this.redis = redis;
    this.databaseEncryptionKey = databaseEncryptionKey;
    this.secretKey = secretKey;
    this.relayPath = relayPath;
    this.relayRetries = relayRetries;
    this.checkDebug = checkDebug;
    this.blockchainsRepository = blockchainsRepository;
  }

  async sendRelay(
    rawData: object,
    application: Applications,
  ): Promise<string | Error> {
    for (let x = 1; x <= this.relayRetries; x++) {
      if (x > 1) {
        console.log('Relay Attempt ' + x);
      }
      const result = await this._sendRelay(rawData, application);
      if (!(result instanceof Error)) {
        return result;
      }
    }
    return new HttpErrors.InternalServerError('Relay attempts exhausted');
  }

  // Private function to allow relay retries
  async _sendRelay(
    rawData: object,
    application: Applications,
  ): Promise<string | Error> {
    // This converts the raw data into formatted JSON then back to a string for relaying.
    // This allows us to take in both [{},{}] arrays of JSON and plain JSON and removes
    // extraneous characters like newlines and tabs from the rawData.
    // Normally the arrays of JSON do not pass the AJV validation used by Loopback.
    const parsedRawData = JSON.parse(rawData.toString());
    const data = JSON.stringify(parsedRawData);

    console.log(
      'RELAYING APP ' +
        application.id +
        ' host: ' +
        this.host +
        ' req: ' +
        data,
    );
    const elapsedStart = process.hrtime();

    const [blockchain, blockchainEnforceResult] = await this.loadBlockchain();

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

    let node,
      method = '';

    // Pull the session so we can get a list of nodes and cherry pick which one to use
    const pocketSession = await this.pocket.sessionManager.getCurrentSession(
      pocketAAT,
      blockchain,
      this.pocketConfiguration,
    );
    if (pocketSession instanceof Session) {
      node = await this.cherryPicker.cherryPickNode(pocketSession, blockchain);
    }

    if (this.checkDebug) {
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
      node,
    );

    if (this.checkDebug) {
      console.log(relayResponse);
    }

    // Method recording for metrics
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
        !this.checkEnforcementJSON(relayResponse.payload) // the relay response is not valid JSON
      ) {
        // then this result is invalid
        // Invalid
        console.log(
          'INVALID ' +
            application.id +
            ' chain: ' +
            blockchain +
            ' req: ' +
            JSON.stringify(data) +
            ' res: ' +
            relayResponse.payload +
            ' node: ' +
            relayResponse.proof.servicerPubKey,
        );

        await this.metricsRecorder.recordMetric({
          appPubKey: application.gatewayAAT.applicationPublicKey,
          blockchain,
          serviceNode: relayResponse.proof.servicerPubKey,
          elapsedStart,
          result: 503,
          bytes: Buffer.byteLength(relayResponse.payload, 'utf8'),
          method: method,
        });
        return new Error(relayResponse.payload);
      } else {
        // Success
        console.log(
          'SUCCESS ' +
            application.id +
            ' chain: ' +
            blockchain +
            ' req: ' +
            JSON.stringify(data) +
            ' res: ' +
            relayResponse.payload +
            ' node: ' +
            relayResponse.proof.servicerPubKey,
        );

        await this.metricsRecorder.recordMetric({
          appPubKey: application.gatewayAAT.applicationPublicKey,
          blockchain,
          serviceNode: relayResponse.proof.servicerPubKey,
          elapsedStart,
          result: 200,
          bytes: Buffer.byteLength(relayResponse.payload, 'utf8'),
          method: method,
        });

        // If return payload is valid JSON, turn it into an object so it is sent with content-type: json
        if (
          blockchainEnforceResult && // Is this blockchain marked for result enforcement // and
          blockchainEnforceResult.toLowerCase() === 'json' // the check is for JSON
        ) {
          return JSON.parse(relayResponse.payload);
        }
        return relayResponse.payload;
      }
    }
    // Error
    else if (relayResponse instanceof RpcError) {
      console.log(
        'ERROR ' +
          application.id +
          ' chain: ' +
          blockchain +
          ' req: ' +
          JSON.stringify(data) +
          ' res: ' +
          relayResponse.message,
      );

      await this.metricsRecorder.recordMetric({
        appPubKey: application.gatewayAAT.applicationPublicKey,
        blockchain,
        serviceNode: node?.publicKey,
        elapsedStart,
        result: 500,
        bytes: Buffer.byteLength(relayResponse.message, 'utf8'),
        method: method,
      });
      return new Error(relayResponse.message);
    }
    // ConsensusNode
    else {
      // TODO: ConsensusNode is a possible return
      return new Error('relayResponse is undefined');
    }
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
      const blockchain = blockchainFilter[0].hash;
      // Record the necessary format for the result; example: JSON
      if (blockchainFilter[0].enforceResult) {
        blockchainEnforceResult = blockchainFilter[0].enforceResult;
      }
      return Promise.resolve([blockchain, blockchainEnforceResult]);
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
