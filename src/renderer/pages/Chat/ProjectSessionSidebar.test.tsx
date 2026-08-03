import { describe, expect, it } from 'vitest'
import { nextExpandedProjectId } from './ProjectSessionSidebar'

describe('project sidebar accordion state', () => {
  it('opens one project at a time and closes the active project when selected again', () => {
    expect(nextExpandedProjectId(null, 'project-1')).toBe('project-1')
    expect(nextExpandedProjectId('project-1', 'project-2')).toBe('project-2')
    expect(nextExpandedProjectId('project-2', 'project-2')).toBeNull()
  })
})
