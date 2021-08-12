import { expect, sinon } from '@loopback/testlab'
import { Pool } from 'pg'
import rewiremock from 'rewiremock'
import { InfluxDB, WriteApi } from '@influxdata/influxdb-client'
import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { Redis } from 'ioredis'
import { CherryPicker } from '../../src/services/cherry-picker'

// Returns a MetricsRecorder class with its external dependencies (pg and influxdb) mocked
export const metricsRecorderMock = (redis: Redis, cherryPicker: CherryPicker): MetricsRecorder => {
  const sandbox = sinon.createSandbox()

  sandbox.replace(InfluxDB.prototype, 'getWriteApi', function (org: string, bucket: string): WriteApi {
    return {
      useDefaultTags: sandbox.stub(),
      writePoint: sandbox.stub(),
      flush: sandbox.stub(),
    } as unknown as WriteApi
  })

  const mockPool = sandbox.mock(new Pool({ connectionString: 'database1' }))
  const mockPool2 = sandbox.mock(new Pool({ connectionString: 'database2' }))

  mockPool.expects('connect').returns({
    query: sandbox.stub(),
  })

  mockPool2.expects('connect').returns({
    query: sandbox.stub(),
  })

  const proxy = rewiremock.proxy(() => require('../../src/services/metrics-recorder'), {
    InfluxDB,
  })

  return new proxy.MetricsRecorder({
    redis,
    pgPool: mockPool,
    pgPool2: mockPool2,
    cherryPicker,
    processUID: '1234',
  })
}
