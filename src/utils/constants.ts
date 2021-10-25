export const EVM_ERROR_CODES = [
  // JSON RPC Standard errors
  '-32',
  // Custom error codes
  '1',
  '2',
  '3',
]

export const MAX_RELAYS_ERROR = 'the evidence is sealed, either max relays reached or claim already submitted'

export const WS_ONLY_METHODS = [
  'eth_getFilterChanges',
  'eth_getFilterLogs',
  'eth_newFilter',
  'eth_subscribe',
  'newBlockFilter',
]
