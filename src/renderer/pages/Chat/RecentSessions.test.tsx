import { describe, expect, it } from 'vitest'
import { shouldShowRecentMore } from './RecentSessions'

describe('RecentSessions', () => {
  it('shows more only while the cumulative visible count is below the total', () => {
    expect(shouldShowRecentMore(15, 16)).toBe(true)
    expect(shouldShowRecentMore(30, 60)).toBe(true)
    expect(shouldShowRecentMore(60, 60)).toBe(false)
  })
})
