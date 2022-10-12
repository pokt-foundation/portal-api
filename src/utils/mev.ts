import axios from 'axios'
import { ethers } from 'ethers'
const logger = require('../services/logger')

const bevUrl = 'https://bev-relay.kolibr.io'

export function isEthSendMethod(rawData) {
  if (rawData instanceof Array) {
    return false
  }
  if (rawData.method === 'eth_sendRawTransaction') {
    return true
  }
  return false
}

export async function checkBevRequest(requestId, txRawData, broadcasterAddress) {
  try {
    const res = await axios.post(bevUrl, {
      jsonrpc: '2.0',
      id: requestId,
      method: 'check_bev',
      params: {
        tx_raw_data: txRawData,
        broadcaster_address: broadcasterAddress,
        wait_searcher_ms: 500,
      },
    })
    if (res?.data?.result?.broadcaster_diff) {
      return res.data.result
    }
  } catch (e) {
    console.log(e.message)
  }

  return false
}

export async function submitBevRequest(requestId, txRawData, bundleHash) {
  try {
    const res = await axios.post(bevUrl, {
      jsonrpc: '2.0',
      id: requestId,
      method: 'submit_bev',
      params: {
        tx_raw_data: txRawData,
        bundle_hash: bundleHash,
      },
    })
    return res?.data?.result
  } catch (e) {
    console.log(e.message)
  }

  return false
}

export async function handleBEVRequest(id, parsedRawData) {
  // store address in Github secrets
  const checkBevResult = await checkBevRequest(id, parsedRawData, '0xb4a70626bde821df5101af2d0f8b080df681f448')
  logger.log('Check BEV result:', checkBevResult)

  if (!checkBevResult) {
    logger.log('Request error')
    return false
  }

  const broadcasterDiff = ethers.BigNumber.from(checkBevResult.broadcaster_diff)
  if (broadcasterDiff.lte(ethers.BigNumber.from(0)) || !checkBevResult.bundle_hash) {
    logger.log('Broadcaster diff <= 0')
    return false
  }

  const submitBevResult = await submitBevRequest(id, parsedRawData, checkBevResult.bundle_hash)
  logger.log('Submit BEV result:', submitBevResult)
  return ethers.utils.keccak256(parsedRawData)
}
