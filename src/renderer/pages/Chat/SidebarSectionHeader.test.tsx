import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SidebarSectionHeader } from './SidebarSectionHeader'

describe('SidebarSectionHeader', () => {
  it('renders a right chevron and collapsed accessibility state', () => {
    const markup = renderToStaticMarkup(<SidebarSectionHeader title="项目" titleId="projects-title" expanded={false} onToggle={() => {}} />)

    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('aria-controls="projects-title-content"')
    expect(markup).toContain('展开项目')
    expect(markup).toContain('项目')
    expect(markup).toContain('<path')
  })

  it('renders a down chevron and expanded accessibility state', () => {
    const markup = renderToStaticMarkup(<SidebarSectionHeader title="最近" titleId="recent-title" expanded onToggle={() => {}} />)

    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-controls="recent-title-content"')
    expect(markup).toContain('收起最近')
  })
})
