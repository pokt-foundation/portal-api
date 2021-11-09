import { Node } from '@pokt-network/pocket-js'
const crypto = require('crypto')

// hashes a blockchain and all of the nodes given, sorted by public key
export function hashBlockchainNodes(blockchain: string, nodes: Node[]): string {
  return `${blockchain}-${crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        nodes.sort((a, b) => (a.publicKey > b.publicKey ? 1 : b.publicKey > a.publicKey ? -1 : 0)),
        (k, v) => (k !== 'publicKey' ? v : undefined)
      )
    )
    .digest('hex')}`
}
