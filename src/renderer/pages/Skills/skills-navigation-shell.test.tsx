import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SkillsAdminShell } from './index'
import { SKILLS_RUNTIME_NAV_ITEMS, SkillsSidebar, getSkillsBreadcrumb, normalizeSkillsView } from './SkillsSidebar'

const counts = Object.fromEntries(SKILLS_RUNTIME_NAV_ITEMS.map((item) => [item.id, 0]))

describe('Skills Runtime navigation shell', () => {
  it('defines the six public Package Runtime views without Creator, Run detail, or permissions pages', () => {
    expect(SKILLS_RUNTIME_NAV_ITEMS.map((item) => item.id)).toEqual([
      'center', 'import', 'detail', 'runs', 'artifacts', 'settings',
    ])
    expect(SKILLS_RUNTIME_NAV_ITEMS.some((item) => (item.id as string) === 'permissions')).toBe(false)
    expect(SKILLS_RUNTIME_NAV_ITEMS.map((item) => item.label)).toEqual([
      'Skills Center', '导入 Skill', 'Skill 详情', '运行记录', 'Artifacts', '系统设置',
    ])
    expect(getSkillsBreadcrumb('runs')).toEqual(['Skills Center', '运行记录'])
    expect(normalizeSkillsView(undefined)).toBe('center')
  })

  it('renders keyboard-focusable Package Runtime navigation', () => {
    const markup = renderToStaticMarkup(<SkillsSidebar view="center" counts={counts} onChange={() => undefined} />)
    expect(markup).toContain('Skills Center')
    expect(markup).toContain('导入 Skill')
    expect(markup).not.toContain('权限与安装')
    expect(markup).toContain('系统设置')
    expect(markup).not.toContain('Skills Creator')
    expect(markup).not.toContain('aria-label="Skills Creator 页面"')
    expect(markup).toContain('aria-current="page"')
    expect(markup).not.toContain('Installed')
    expect(markup).not.toContain('Available / Import')
  })

  it('mounts the App Skills entry on the Runtime shell', () => {
    const markup = renderToStaticMarkup(<SkillsAdminShell />)
    expect(markup).toContain('data-testid="skills-admin-shell"')
    expect(markup).not.toContain('Runtime Healthy')
    expect(markup).not.toContain('Runtime Checking')
    expect(markup).not.toContain('· Worker')
    expect(markup).toContain('面包屑')
  })
})
