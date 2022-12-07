import { expect } from '@loopback/testlab'

describe('Utility (unit)', () => {
  it('Should reduce multi-method calls for metrics/logging purposes', () => {
    let method = 'eth_getTransactionReceipt,eth_getTransactionByHash,eth_getBlockByNumber'

    if (method && method.split(',').length > 1) {
      method = 'multiple'
    }

    expect(method).to.to.be.equal('multiple')
  })

  it('Should not reduce single method call for metrics/logging purposes', () => {
    let method = 'eth_getBlockByNumber'

    if (method && method.split(',').length > 1) {
      method = 'multiple'
    }

    expect(method).to.to.be.equal('eth_getBlockByNumber')
  })

  it('Does not fail when method is undefined', () => {
    let method = undefined

    if (method && method.split(',').length > 1) {
      method = 'multiple'
    }

    expect(method).to.to.be.equal(undefined)
  })
})
