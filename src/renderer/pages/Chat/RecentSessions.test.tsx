import { describe, expect, it } from 'vitest'
import { recentSectionTitle, shouldShowRecentMore } from './RecentSessions'

describe('RecentSessions', () => {
  it('uses the requested chat section title', () => {
    expect(recentSectionTitle(4)).toBe('聊天 (4)')
  })

  it('shows more only while the cumulative visible count is below the total', () => {
    expect(shouldShowRecentMore(15, 16)).toBe(true)
    expect(shouldShowRecentMore(30, 60)).toBe(true)
    expect(shouldShowRecentMore(60, 60)).toBe(false)
  })
})
