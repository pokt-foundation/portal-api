export const MAX_RELAYS_ERROR = 'the evidence is sealed, either max relays reached or claim already submitted'

export const BLOCK_TIMING_ERROR =
  'Provided Node is not part of the current session for this application, check your PocketAAT'

export const WS_ONLY_METHODS = [
  'eth_getFilterChanges',
  'eth_getFilterLogs',
  'eth_newFilter',
  'eth_subscribe',
  'newBlockFilter',
]

export const SESSION_TIMEOUT = 2000
export const CHECK_TIMEOUT = 4000
export const DEFAULT_ALTRUIST_TIMEOUT = 60000 // Milliseconds

export const PERCENTAGE_THRESHOLD_TO_REMOVE_SESSION = 0.7
