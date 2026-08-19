import { describe, expect, it } from 'vitest'
import { formatSessionRelativeTime } from './session-time'

describe('formatSessionRelativeTime', () => {
  const now = 1_700_000_000_000

  it('formats minutes and hours in Chinese', () => {
    expect(formatSessionRelativeTime(now - 4 * 60_000, now)).toBe('4分钟前')
    expect(formatSessionRelativeTime(now - 3 * 60 * 60_000, now)).toBe('3小时前')
  })

  it('formats days without a leading zero', () => {
    expect(formatSessionRelativeTime(now - 17 * 24 * 60 * 60_000, now)).toBe('17天前')
    expect(formatSessionRelativeTime(now - 14 * 24 * 60 * 60_000, now)).toBe('14天前')
  })

  it('uses 刚刚 for current and future timestamps', () => {
    expect(formatSessionRelativeTime(now, now)).toBe('刚刚')
    expect(formatSessionRelativeTime(now + 60_000, now)).toBe('刚刚')
  })
})
