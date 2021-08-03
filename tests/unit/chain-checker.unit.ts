import { MetricsRecorder } from '../../src/services/metrics-recorder'
import { RedisMock } from 'ioredis-mock'
import { metricsRecorderMock } from '../mocks/metricsRecorder'
import { CherryPicker } from '../../src/services/cherry-picker'
import { ChainChecker } from '../../src/services/chain-checker'
import { expect } from '@loopback/testlab'

describe('Chain checker service (unit)', () => {
  let chainChecker: ChainChecker
  let metricsRecorder: MetricsRecorder
  let redis: RedisMock
  let cherryPicker: CherryPicker

  before('initialize variables', async () => {
    redis = new RedisMock(0, '')
    cherryPicker = new CherryPicker({ redis, checkDebug: false })
    metricsRecorder = metricsRecorderMock(redis, cherryPicker)
    chainChecker = new ChainChecker(redis, metricsRecorder)
  })

  it('should be defined', async () => {
    expect(chainChecker).to.be.ok()
  })
})
