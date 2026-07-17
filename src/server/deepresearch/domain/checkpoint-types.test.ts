import { describe, expect, it } from 'vitest'
import { cursorFromLegacyResumePhase, projectLegacyResumePhase } from './checkpoint-types'

describe('checkpoint cursor compatibility', () => {
  it('projects a legacy resume phase into a conservative V2 cursor', () => {
    expect(cursorFromLegacyResumePhase('planning')).toEqual({ version: 1, nextPhase: 'planning', iteration: 0 })
    expect(cursorFromLegacyResumePhase(null)).toBeNull()
  })

  it('projects a V2 cursor back into the retained legacy resume phase field', () => {
    expect(projectLegacyResumePhase({ version: 1, nextPhase: 'assessing_coverage', iteration: 2 })).toBe('assessing_coverage')
    expect(projectLegacyResumePhase(null)).toBeNull()
  })
})
