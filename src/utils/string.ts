export function checkEnforcementJSON(test: string): boolean {
  if (!test || test.length === 0) {
    return false
  }
  // Code from: https://github.com/prototypejs/prototype/blob/560bb59414fc9343ce85429b91b1e1b82fdc6812/src/prototype/lang/string.js#L699
  // Prototype lib
  if (/^\s*$/.test(test)) {
    return false
  }
  test = test.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '@')
  test = test.replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']')
  test = test.replace(/(?:^|:|,)(?:\s*\[)+/g, '')
  return /^[\],:{}\s]*$/.test(test)
}

// Check passed in string against an array of whitelisted items
// Type can be "explicit" or substring match
export function checkWhitelist(tests: string[], check: string, type: string): boolean {
  if (!tests || tests.length === 0) {
    return true
  }
  if (!check) {
    return false
  }

  for (const test of tests) {
    if (type === 'explicit') {
      if (test.toLowerCase() === check.toLowerCase()) {
        return true
      }
    } else {
      if (check.toLowerCase().includes(test.toLowerCase())) {
        return true
      }
    }
  }
  return false
}

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
