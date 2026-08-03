import { describe, expect, it } from 'vitest'
import { nextRecentVisibleCount, shouldShowProjectSessionsMore, visibleProjectCount } from './project-sidebar.utils'

describe('project sidebar pagination utilities', () => {
  it('grows recent sessions cumulatively from 15 to 30 then doubles without exceeding total', () => {
    expect(nextRecentVisibleCount(15, 100)).toBe(30)
    expect(nextRecentVisibleCount(30, 100)).toBe(60)
    expect(nextRecentVisibleCount(60, 100)).toBe(100)
    expect(nextRecentVisibleCount(100, 100)).toBe(100)
  })

  it('limits projects to six until folders are expanded', () => {
    expect(visibleProjectCount(4, false)).toBe(4)
    expect(visibleProjectCount(7, false)).toBe(6)
    expect(visibleProjectCount(7, true)).toBe(7)
  })

  it('only shows project-session expansion when more than ten sessions are collapsed', () => {
    expect(shouldShowProjectSessionsMore(10, false)).toBe(false)
    expect(shouldShowProjectSessionsMore(11, false)).toBe(true)
    expect(shouldShowProjectSessionsMore(11, true)).toBe(false)
  })
})