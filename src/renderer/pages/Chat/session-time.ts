const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatSessionRelativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < MINUTE) return '刚刚'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}分钟前`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}小时前`
  return `${Math.floor(elapsed / DAY)}天前`
}
