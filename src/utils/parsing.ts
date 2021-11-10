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
