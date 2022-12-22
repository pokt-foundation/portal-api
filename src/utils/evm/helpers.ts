import { Wallet } from 'ethers'

export function getRandomAddress(): string {
  let address = '0xe5Fb31A5CaEE6a96de393bdBF89FBe65fe125Bb3'
  try {
    const wallet = Wallet.createRandom()
    address = wallet.address
  } catch {
    // Ignore, use default
  }
  return address
}
