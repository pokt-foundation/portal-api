import { Pool } from 'pg'
import sinon from 'sinon'
import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client'
import { Cache } from '../../src/services/cache'
import { CherryPicker } from '../../src/services/cherry-picker'
import { MetricsRecorder } from '../../src/services/metrics-recorder'

// import { metricsRecorderMock } from '../mocks/metrics-recorder'

const Redis = require('ioredis-mock')

describe('Metrics Recorder (unit)', () => {
  let cache: Cache
  let pgPool: Pool
  let influxClient: InfluxDB
  let influxWriteApi: WriteApi
  let writeInfluxSpy: sinon.SinonSpy
  let cherryPicker: CherryPicker
  let metricsRecorder: MetricsRecorder

  before('Initialize variables', async () => {
    cache = new Cache(new Redis(0, ''), new Redis(1, ''))
    pgPool = new Pool({ connectionString: 'database1' })
    cherryPicker = new CherryPicker({ redis: cache.remote, checkDebug: false })

    // InfluxDB Mocking
    influxClient = new InfluxDB({ url: 'https://url.com', token: 'token' })
    influxWriteApi = influxClient.getWriteApi('org', 'bucket')

    sinon.stub(pgPool)
  })

  beforeEach('Setting up mock metrics recorder', async () => {
    writeInfluxSpy = sinon.spy(influxWriteApi, 'writePoint')
    influxWriteApi.writePoint = writeInfluxSpy

    // Mocked Metrics Recorder
    metricsRecorder = new MetricsRecorder({
      redis: cache.remote,
      pgPool,
      influxWriteAPIs: [influxWriteApi],
      cherryPicker,
      processUID: '1234',
    })
  })

  afterEach(() => {
    sinon.restore()
  })

  it('Should reduce multi-method calls for metrics/logging purposes', async () => {
    await metricsRecorder
      .recordMetric({
        requestID: '',
        applicationID: '',
        applicationPublicKey: 'app-pub-key',
        blockchain: 'eth-mainnet',
        blockchainID: '0021',
        serviceNode: 'node-xyz',
        relayStart: [0, 1],
        result: 500,
        bytes: 5,
        fallback: false,
        method: 'eth_getBlockByNumber,eth_getBlockByNumber,eth_getBlockByNumber',
        error: '',
        code: String(''),
        session: {
          blockHeight: 0,
          header: {
            applicationPubKey: '',
            chain: '',
            sessionBlockHeight: 2,
          },
          key: '',
          nodes: [],
        },
        origin: 'my-origin',
        sticky: '',
        gigastakeAppID: '',
        url: '',
      })
      .then(() => {
        sinon.assert.calledTwice(writeInfluxSpy)

        const pointRelay = new Point('relay')
          .tag('applicationPublicKey', 'app-pub-key')
          .tag('nodePublicKey', 'network')
          .tag('method', 'multiple')
          .tag('result', '500')
          .tag('blockchain', '0021') // 0021
          .tag('blockchainSubdomain', 'eth-mainnet') // eth-mainnet
          .tag('region', process.env.REGION || '')
          .floatField('bytes', 5)

        sinon.assert.calledWith(writeInfluxSpy.firstCall, sinon.match(pointRelay))
      })
  })

  it('Should not reduce single method call for metrics/logging purposes', async () => {
    await metricsRecorder
      .recordMetric({
        requestID: '',
        applicationID: '',
        applicationPublicKey: 'app-pub-key',
        blockchain: 'eth-mainnet',
        blockchainID: '0021',
        serviceNode: 'node-xyz',
        relayStart: [0, 1],
        result: 500,
        bytes: 5,
        fallback: false,
        method: 'eth_getBlockByNumber',
        error: '',
        code: String(''),
        session: {
          blockHeight: 0,
          header: {
            applicationPubKey: '',
            chain: '',
            sessionBlockHeight: 2,
          },
          key: '',
          nodes: [],
        },
        origin: 'my-origin',
        sticky: '',
        gigastakeAppID: '',
        url: '',
      })
      .then(() => {
        sinon.assert.calledTwice(writeInfluxSpy)

        const pointRelay = new Point('relay')
          .tag('applicationPublicKey', 'app-pub-key')
          .tag('nodePublicKey', 'network')
          .tag('method', 'eth_getBlockByNumber')
          .tag('result', '500')
          .tag('blockchain', '0021') // 0021
          .tag('blockchainSubdomain', 'eth-mainnet') // eth-mainnet
          .tag('region', process.env.REGION || '')
          .floatField('bytes', 5)

        sinon.assert.calledWith(writeInfluxSpy.firstCall, sinon.match(pointRelay))
      })
  })
})
