export const EVM_ERRORS = [
  '-32000', // Generic error code for EVM (Geth, and other clients)
]

export const MAX_RELAYS_ERROR = 'the evidence is sealed, either max relays reached or claim already submitted'

export const WS_ONLY_METHODS = [
  'eth_getFilterChanges',
  'eth_getFilterLogs',
  'eth_newFilter',
  'eth_subscribe',
  'newBlockFilter',
]
