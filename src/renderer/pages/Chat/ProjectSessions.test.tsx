import { describe, expect, it } from 'vitest'
import { projectSessionsDisplayAction } from './ProjectSessions'

describe('ProjectSessions', () => {
  it('offers expand at eleven sessions and collapse after all eleven are loaded', () => {
    expect(projectSessionsDisplayAction(10, 10)).toBeNull()
    expect(projectSessionsDisplayAction(11, 10)).toBe('expand')
    expect(projectSessionsDisplayAction(11, 11)).toBe('collapse')
  })
})
