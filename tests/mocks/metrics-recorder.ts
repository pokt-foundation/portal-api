import { Redis } from 'ioredis'
import { Pool } from 'pg'
import { sinon } from '@loopback/testlab'
import { InfluxDB } from '@influxdata/influxdb-client'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'

// Returns a MetricsRecorder class with its external dependencies (pg,influxdb) mocked
export const metricsRecorderMock = (redis: Redis, cherryPicker: CherryPicker): MetricsRecorder => {
  const influxClient = new InfluxDB({ url: 'https://url.com', token: 'token' })
  const writeApi = influxClient.getWriteApi('org', 'bucket')
  const pgPool = new Pool({ connectionString: 'database1' })

  sinon.stub(writeApi)
  sinon.stub(pgPool)

  return new MetricsRecorder({
    redis,
    pgPool,
    influxWriteAPIs: [writeApi],
    cherryPicker,
    processUID: '1234',
  })
}
