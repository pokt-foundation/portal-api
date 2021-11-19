import { Node } from '@pokt-network/pocket-js'
const crypto = require('crypto')

// hashes a blockchain and all of the nodes given, sorted by public key
export function hashBlockchainNodes(blockchainID: string, nodes: Node[] = []): string {
  return `${blockchainID}-${crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        nodes.sort((a, b) => (a.publicKey > b.publicKey ? 1 : b.publicKey > a.publicKey ? -1 : 0)),
        (k, v) => (k !== 'publicKey' ? v : undefined)
      )
    )
    .digest('hex')}`
}

export function getNextRPCID(rpcID: number, rawData: string | object): number {
  const parsedRawData = Object.keys(rawData).length > 0 ? JSON.parse(rawData.toString()) : JSON.stringify(rawData)
  let nextRPCID = rpcID + 1

  // If this was a stacked RPC call with multiple calls in an array, increment the RPC ID accordingly
  if (parsedRawData instanceof Array) {
    nextRPCID = rpcID + parsedRawData.length
  }

  return nextRPCID
}
