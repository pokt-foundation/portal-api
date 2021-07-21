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
