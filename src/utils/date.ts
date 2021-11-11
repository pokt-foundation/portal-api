export function getSecondsForNextHour(): number {
  const ms = 3600000 - (new Date().getTime() % 3600000)

  return Math.floor(ms * 0.001)
}
