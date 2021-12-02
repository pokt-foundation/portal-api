// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseMethod(parsedRawData: Record<string, any>): string {
  // Method recording for metrics
  let method = ''

  if (parsedRawData instanceof Array) {
    // Join the methods of calls in an array for chains that can join multiple calls in one
    for (const key in parsedRawData) {
      if (parsedRawData[key].method) {
        if (method) {
          method += ','
        }
        method += parsedRawData[key].method
      }
    }
  } else if (parsedRawData.method) {
    method = parsedRawData.method
  }
  return method
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseRawData(rawData: string | object): Record<string, any> {
  return Object.keys(rawData).length > 0 ? JSON.parse(rawData.toString()) : JSON.stringify(rawData)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseRPCID(parsedRawData: Record<string, any>): number {
  // RPC ID for client-node stickiness
  let rpcID = 0

  if (parsedRawData instanceof Array) {
    // Locate the lowest RPC ID
    for (const key in parsedRawData) {
      if (parsedRawData[key].id && (!rpcID || parsedRawData[key].id < rpcID)) {
        rpcID = parsedRawData[key].id
      }
    }
  } else if (parsedRawData.id) {
    rpcID = parsedRawData.id
  }
  return rpcID
}
