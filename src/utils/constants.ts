export const DEFAULT_BLOCK_LOGS_LIMIT = 10000 // Should never be 0

export const MAX_RELAYS_ERROR = 'the evidence is sealed, either max relays reached or claim already submitted'

export const WS_ONLY_METHODS = [
  'eth_getFilterChanges',
  'eth_getFilterLogs',
  'eth_newFilter',
  'eth_subscribe',
  'newBlockFilter',
]

export const ARCHIVAL_CHAINS = [
  '0022', // Ethereum
  '0028', // Ethereum trace
  '0010', // Binance Smart Chain
  '000A', // Fuse
  '000B', // Polygon Matic
  '000C', // POA xDai
]
