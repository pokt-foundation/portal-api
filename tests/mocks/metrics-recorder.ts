import AWS from 'aws-sdk'

import { Redis } from 'ioredis'
import { Pool } from 'pg'
import { sinon } from '@loopback/testlab'
import { InfluxDB } from '@influxdata/influxdb-client'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'

const https = require('https')

// Returns a MetricsRecorder class with its external dependencies (pg,influxdb, timestream) mocked
export const metricsRecorderMock = (redis: Redis, cherryPicker: CherryPicker): MetricsRecorder => {
  const influxClient = new InfluxDB({ url: 'https://url.com', token: 'token' })
  const writeApi = influxClient.getWriteApi('org', 'bucket')

  const timestreamAgent = new https.Agent({
    maxSockets: 5000,
  })
  const timestreamClient = new AWS.TimestreamWrite({
    maxRetries: 10,
    httpOptions: {
      timeout: 20000,
      agent: timestreamAgent,
    },
    region: 'us-east-2',
  })

  const pgPool = new Pool({ connectionString: 'database1' })

  sinon.stub(writeApi)
  sinon.stub(timestreamClient)
  sinon.stub(pgPool)

  return new MetricsRecorder({
    redis,
    pgPool,
    influxWriteAPI: writeApi,
    cherryPicker,
    processUID: '1234',
    timestreamClient,
  })
}
