import { describe, expect, it } from 'vitest'
import { expandProjectId, toggleExpandedProjectId } from './ProjectSessionSidebar'

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
})
