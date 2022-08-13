import { expect } from '@loopback/testlab'
import { decodeEthRawTxAddress, extractContractAddress } from '../../src/utils/evm/parsing'

describe('EVM utilities (unit)', () => {
  it('should return an address from a eth raw tx hex', () => {
    const ethTxHex =
      '0xf86d8301ae13843b9aca00831e848094e44000972e7c737a2d43609c2254a8f7b646bf9d80844641257d820118a0272dd734582f2965b3989d1c2e32fdc7d76434e7082fce5dada6a8d88e26564ba066729c21be992d9f966ea0b3f69b4033e1595fc8b2f8761d8d0dd73ae96a26f1'

    const address = decodeEthRawTxAddress(ethTxHex)

    expect(address).to.to.be.equal('0xe44000972e7c737a2d43609c2254a8f7b646bf9d')
  })

  describe('Extract contract addresses', () => {
    it('should successfully extract contract address from a `eth_sendRawTransaction` call', () => {
      const call = {
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_sendRawTransaction',
        params: [
          '0xf86d8301ae13843b9aca00831e848094e44000972e7c737a2d43609c2254a8f7b646bf9d80844641257d820118a0272dd734582f2965b3989d1c2e32fdc7d76434e7082fce5dada6a8d88e26564ba066729c21be992d9f966ea0b3f69b4033e1595fc8b2f8761d8d0dd73ae96a26f1',
        ],
      }

      const address = extractContractAddress(call)

      expect(address).to.to.be.equal('0xe44000972e7c737a2d43609c2254a8f7b646bf9d')
    })

    it('should successfully extract contract address from a `eth_sendRawTransaction` EIP1559 call', () => {
      const call = {
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_sendRawTransaction',
        params: [
          '0x02f8b401830153b4843b9aca008507f3be98328301d4c094dac17f958d2ee523a2206206994597c13d831ec780b844a9059cbb000000000000000000000000622779096805724b38c42b51989ddca32d671a000000000000000000000000000000000000000000000000000000000022df0080c001a0236084da36000fb2c7373cfa78e8f1bc9d8eb081dc240630c8024aa06fc39f96a030bdc5cd4e1f5f6abbb36c3b004270b68724cc46c56ad5847c99f8ced9c4112d',
        ],
      }

      const address = extractContractAddress(call)

      expect(address).to.to.be.equal('0xdac17f958d2ee523a2206206994597c13d831ec7')
    })

    it('should successfully extract contract address from a `eth_call` call', () => {
      const call = {
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
          {
            to: '0xf012702a5f0e54015362cBCA26a26fc90AA832a3',
            data: '0xd06ca61f0000000000000000000000000000000000000000000000005b1359e3fb7fc44400000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000002000000000000000000000000cf664087a5bb0237a0bad6742852ec6c8d69a27a000000000000000000000000985458e523db3d53125813ed68c274899e9dfab4',
          },
          'latest',
        ],
        id: 1,
      }

      const address = extractContractAddress(call)

      expect(address).to.to.be.equal('0xf012702a5f0e54015362cBCA26a26fc90AA832a3')
    })

    it('should successfully extract contract address from a `eth_getLogs` call', () => {
      const call = {
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_getLogs',
        params: [
          {
            fromBlock: '0x17585f5',
            toBlock: '0x17585f6',
            address: '0xb80a07e13240c31ec6dc0b5d72af79d461da3a70',
            topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
          },
        ],
      }

      const address = extractContractAddress(call)

      expect(address).to.to.be.equal('0xb80a07e13240c31ec6dc0b5d72af79d461da3a70')
    })

    it('should successfully extract contract address from a `eth_getBalance` call', () => {
      const call = {
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: ['0x3a59d3f892da39235a5649fed80e832b4066d309', '0x191d935'],
      }

      const address = extractContractAddress(call)

      expect(address).to.to.be.equal('0x3a59d3f892da39235a5649fed80e832b4066d309')
    })

    it('should successfully extract contract address from a `eth_getTransactionCount` call', () => {
      const call = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionCount',
        params: ['0x0f0edc5e5191c6d0baf64eec4c755c49f3048cdf', 'latest'],
      }

      const address = extractContractAddress(call)

      expect(address).to.to.be.equal('0x0f0edc5e5191c6d0baf64eec4c755c49f3048cdf')
    })

    it('should successfully extract contract address from a `eth_getStorageAt` call', () => {
      const call = {
        jsonrpc: '2.0',
        method: 'eth_getStorageAt',
        params: ['0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9', '0x38', '0xdc8c48'],
        id: 1,
      }

      const address = extractContractAddress(call)

      expect(address).to.to.be.equal('0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9')
    })

    it('should successfully extract contract address from a `eth_getCode` call', () => {
      const call = {
        jsonrpc: '2.0',
        method: 'eth_getCode',
        params: ['0x34965ba0ac2451A34a0471F04CCa3F990b8dea27', 'latest'],
        id: 1,
      }

      const address = extractContractAddress(call)

      expect(address).to.to.be.equal('0x34965ba0ac2451A34a0471F04CCa3F990b8dea27')
    })
  })
})
