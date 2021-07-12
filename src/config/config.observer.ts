import {inject, lifeCycleObserver, LifeCycleObserver} from '@loopback/core';

@lifeCycleObserver('config')
export class ConfigurationLoader implements LifeCycleObserver {
  private environmentVariablesNames: Array<string>
  constructor(@inject('environment.variables') environmentVariablesNames: Array<string>) {
    this.environmentVariablesNames = environmentVariablesNames;
  }

  init() {
    throw this.environmentVariablesNames;
  }
}
