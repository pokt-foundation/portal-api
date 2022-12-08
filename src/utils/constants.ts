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

export enum CheckMethods {
  SyncCheck = 'synchceck',
  ChainCheck = 'chaincheck',
  MergeCheck = 'mergecheck',
}

export const GNOSIS_BLOCKCHAIN_IDS = [
  '0027', // Gnosis Chain
  '000C', // Gnosis Chain Archival
]

export const ETHEREUM_BLOCKCHAIN_IDS = [
  '0021', // Ethereum Mainnet
  '0022', // Ethereum Rinkeby
  '0028', // Ethereum Archival Trace
]

export const MERGE_CHECK_BLOCKCHAIN_IDS = [...ETHEREUM_BLOCKCHAIN_IDS, ...GNOSIS_BLOCKCHAIN_IDS]
