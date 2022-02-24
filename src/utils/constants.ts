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

export const POCKET_JS_INSTANCE_TIMEOUT_KEY = 'pocket-js-timeout'
export const POCKET_JS_TIMEOUT_MIN = 60 // Seconds
export const POCKET_JS_TIMEOUT_MAX = 120 // Seconds
export const DEFAULT_ALTRUIST_TIMEOUT = 60000 // Millisseconds
