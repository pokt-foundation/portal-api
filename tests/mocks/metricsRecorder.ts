import { Redis } from 'ioredis'
import { Pool } from 'pg'
import rewiremock from 'rewiremock'
import { sinon } from '@loopback/testlab'
import { InfluxDB, WriteApi } from '@influxdata/influxdb-client'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'

// Returns a MetricsRecorder class with its external dependencies (pg and influxdb) mocked
export const metricsRecorderMock = (redis: Redis, cherryPicker: CherryPicker): MetricsRecorder => {
  sinon.replace(InfluxDB.prototype, 'getWriteApi', function (org: string, bucket: string): WriteApi {
    return {
      useDefaultTags: sinon.stub(),
      writePoint: sinon.stub(),
      flush: sinon.stub(),
    } as unknown as WriteApi
  })

  const mockPool = sinon.mock(new Pool({ connectionString: 'database1' }))
  const mockPool2 = sinon.mock(new Pool({ connectionString: 'database2' }))

  mockPool.expects('connect').returns({
    query: sinon.stub(),
  })

  mockPool2.expects('connect').returns({
    query: sinon.stub(),
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
