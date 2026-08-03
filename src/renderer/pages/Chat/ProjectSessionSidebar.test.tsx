import { describe, expect, it } from 'vitest'
import { clampProjectSectionRatio, nextExpandedProjectId, projectSectionRatioFromPointer } from './ProjectSessionSidebar'

describe('project sidebar accordion state', () => {
  it('opens one project at a time and closes the active project when selected again', () => {
    expect(nextExpandedProjectId(null, 'project-1')).toBe('project-1')
    expect(nextExpandedProjectId('project-1', 'project-2')).toBe('project-2')
    expect(nextExpandedProjectId('project-2', 'project-2')).toBeNull()
  })

  it('keeps the draggable split within usable bounds', () => {
    expect(clampProjectSectionRatio(0)).toBe(0.2)
    expect(clampProjectSectionRatio(0.5)).toBe(0.5)
    expect(clampProjectSectionRatio(1)).toBe(0.8)
    expect(projectSectionRatioFromPointer(500, 0, 500, 500, 6)).toBeCloseTo(0.497)
    expect(projectSectionRatioFromPointer(-100, 0, 500, 500, 6)).toBe(0.2)
    expect(projectSectionRatioFromPointer(1200, 0, 500, 500, 6)).toBe(0.8)
  })
})
