import {
  BaseProfiler,
  ProfileResult,
} from '@pokt-network/pocket-js';

const logger = require('../services/logger');

export class RelayProfiler extends BaseProfiler {
  public data: {key: string, time_elapsed: number | undefined}[] = []

  flushResults(functionName: string, results: ProfileResult[]): void {
    const resultsJSON: object[] = [];
    results.forEach(function(result) {
        resultsJSON.push(result.toJSON());
    })

    const obj = {
        function_name: functionName,
        results: resultsJSON
    };

    logger.log('debug', JSON.stringify(obj), {requestID: '', relayType: '', typeID: '', serviceNode: '', error: '', elapsedTime: ''});
  }
}