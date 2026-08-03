import { describe, expect, it } from 'vitest'
import { clampProjectSectionRatio, expandProjectId, projectSectionRatioFromPointer, toggleExpandedProjectId } from './ProjectSessionSidebar'

describe('project sidebar accordion state', () => {
  it('toggles only the selected project while preserving other expanded projects', () => {
    const first = toggleExpandedProjectId(new Set(), 'project-1')
    const both = toggleExpandedProjectId(first, 'project-2')
    const onlySecond = toggleExpandedProjectId(both, 'project-1')

    expect([...first]).toEqual(['project-1'])
    expect([...both]).toEqual(['project-1', 'project-2'])
    expect([...onlySecond]).toEqual(['project-2'])
  })

  it('expands a project without collapsing other expanded projects', () => {
    const expanded = expandProjectId(new Set(['project-1']), 'project-2')

    expect([...expanded]).toEqual(['project-1', 'project-2'])
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
