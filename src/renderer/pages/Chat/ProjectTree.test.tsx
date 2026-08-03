import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProjectSummary } from '@shared/schemas'
import { ProjectTree } from './ProjectTree'

const project = (index: number): ProjectSummary => ({
  id: `project-${index}`,
  name: `项目 ${index}`,
  root_path: `D:/projects/${index}`,
  directory_kind: 'auto',
  created_at: index,
  updated_at: index,
  sessionCount: index,
})

const props = {
  expandedProjectId: null,
  onToggleProject: () => {},
  onCreateSession: () => {},
  onToggleProjectList: () => {},
}

describe('ProjectTree', () => {
  it('shows all six projects without a more-folders control', () => {
    const markup = renderToStaticMarkup(<ProjectTree {...props} projects={Array.from({ length: 6 }, (_, index) => project(index + 1))} projectListExpanded={false} />)
    expect(markup).toContain('项目 6')
    expect(markup).not.toContain('更多文件夹')
  })

  it('shows six of seven projects and exposes an accessible more-folders control', () => {
    const markup = renderToStaticMarkup(<ProjectTree {...props} projects={Array.from({ length: 7 }, (_, index) => project(index + 1))} projectListExpanded={false} />)
    expect(markup).toContain('项目 6')
    expect(markup).not.toContain('项目 7')
    expect(markup).toContain('更多文件夹')
    expect(markup).toContain('aria-expanded="false"')
  })
})
