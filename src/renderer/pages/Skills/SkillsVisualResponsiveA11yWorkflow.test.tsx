import React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SkillsSidebar } from './SkillsSidebar'
import { SkillsCenterWorkbench } from './SkillsCenterWorkbench'

const skillsGlobalCss = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8')

const hasRule = (selector: string, declaration: RegExp) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = skillsGlobalCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 's'))
  return match ? declaration.test(match[1]) : false
}

describe('P3-010 visual, responsive and accessibility contract', () => {
  it('defines the v1.2 shared visual tokens and semantic status palette', () => {
    for (const [name, value] of [
      ['--skills-bg-secondary', '#F5F5F4'],
      ['--skills-bg-primary', '#FFFFFF'],
      ['--skills-bg-tertiary', '#EEEDE9'],
      ['--skills-text-primary', '#1A1A18'],
      ['--skills-border-tertiary', '#DDDBD6'],
      ['--skills-brand-purple', '#7C6FF7'],
      ['--skills-brand-blue', '#4B9BF5'],
    ]) {
      expect(skillsGlobalCss).toContain(`${name}: ${value}`)
    }
    expect(skillsGlobalCss).toContain('--skills-brand-gradient: linear-gradient(135deg, var(--skills-brand-purple), var(--skills-brand-blue))')
    expect(hasRule('.skills-status.success', /color:\s*var\(--text-success\)/)).toBe(true)
    expect(hasRule('.skills-status.warning', /color:\s*var\(--text-warning\)/)).toBe(true)
    expect(hasRule('.skills-status.danger', /color:\s*var\(--text-danger\)/)).toBe(true)
    expect(hasRule('.skills-status.info', /color:\s*var\(--text-info\)/)).toBe(true)
    expect(skillsGlobalCss).toMatch(/\.skills-runtime-page\s*\{[^}]*min-height:\s*100%;/s)
    expect(skillsGlobalCss).toMatch(/overflow:\s*visible;\s*background:\s*var\(--skills-bg-primary\);/s)
  })

  it('unifies focus rings, tooltips, notices and minimum touch targets', () => {
    expect(skillsGlobalCss).toContain('--skills-touch-target: 29px')
    expect(skillsGlobalCss).toContain('--skills-focus-ring: 3px solid color-mix(in srgb, var(--skills-brand-purple) 58%, transparent)')
    expect(skillsGlobalCss).toContain('.skills-runtime-page button:focus-visible')
    expect(skillsGlobalCss).toContain('.skills-runtime-page input:focus-visible')
    expect(skillsGlobalCss).toContain('.skills-tooltip')
    expect(skillsGlobalCss).toContain('.skills-notice')
    expect(skillsGlobalCss).toContain('min-width: var(--skills-touch-target)')
    expect(skillsGlobalCss).toContain('min-height: var(--skills-touch-target)')
  })

  it('keeps 1120px and 860px responsive contracts and horizontally scrollable tables', () => {
    expect(skillsGlobalCss).toMatch(/@media\s*\(max-width:\s*1120px\)/)
    expect(skillsGlobalCss).toMatch(/@media\s*\(max-width:\s*860px\)/)
    expect(skillsGlobalCss).toContain('.skills-runtime-page .skills-center-topbar-tools')
    expect(skillsGlobalCss).toContain('.skills-runtime-page .skills-center-search input')
    expect(skillsGlobalCss).toContain('.skills-runtime-page .skills-center-filterbar select')
    expect(skillsGlobalCss).toContain('.skills-runtime-page .skills-text-button')
    expect(skillsGlobalCss).toContain('.skills-center-table-wrap { overflow-x: auto; }')
    expect(skillsGlobalCss).toContain('.skills-table-scroll')
    expect(skillsGlobalCss).toMatch(/\.skills-center-main \{[^}]*padding:\s*14px 18px 24px/s)
    expect(skillsGlobalCss).toContain('.skills-center-sidebar { width: 220px;')
    expect(hasRule('.skills-import-tabs', /display:\s*flex/)).toBe(true)
    expect(hasRule('.skills-import-tabs', /overflow-x:\s*auto/)).toBe(true)
    expect(hasRule('.skills-import-tabs > button', /border-bottom:\s*2px solid transparent/)).toBe(true)
    expect(hasRule('.skills-import-tabs > button', /border-radius:\s*0/)).toBe(true)
    expect(skillsGlobalCss).toContain('.skills-import-tabs > button:focus-visible')
    expect(skillsGlobalCss).toMatch(/\.skills-import-page \.skills-field input:focus,[\s\S]*?outline:\s*none;[\s\S]*?border-color:\s*var\(--border-secondary\)/)
    expect(skillsGlobalCss).toMatch(/@media\s*\(max-width:\s*620px\)[\s\S]*\.skills-import-audit-grid[^}]*grid-template-columns:\s*1fr/s)
  })

  it('keeps the catalog KPI and status language sections in a responsive layout', () => {
    expect(skillsGlobalCss).toMatch(/\.skills-catalog\s*\{[^}]*display:\s*grid/s)
    expect(skillsGlobalCss).toMatch(/\.skills-catalog-kpis\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s)
    expect(skillsGlobalCss).toMatch(/\.skills-kpi-card\s*\{[^}]*display:\s*flex/s)
    expect(skillsGlobalCss).toMatch(/\.skills-status-language\s*\{[^}]*display:\s*flex/s)
    expect(skillsGlobalCss).toMatch(/\.skills-status-language-list\s*\{[^}]*display:\s*flex/s)
    expect(skillsGlobalCss).toMatch(/@media\s*\(max-width:\s*860px\)[\s\S]*\.skills-catalog-kpis[^}]*grid-template-columns:\s*repeat\(2,/s)
    expect(skillsGlobalCss).toMatch(/@media\s*\(max-width:\s*620px\)[\s\S]*\.skills-catalog-kpis[^}]*grid-template-columns:\s*1fr/s)
  })

  it('keeps keyboard-addressable navigation and labeled search/action controls', () => {
    const sidebar = renderToStaticMarkup(<SkillsSidebar view="center" counts={{}} onChange={() => undefined} />)
    expect(sidebar).toContain('<nav aria-label="Skills Runtime 页面">')
    expect(sidebar).toContain('type="button"')
    expect(sidebar).toContain('aria-current="page"')
    expect(sidebar).toContain('title="运行记录"')
    expect(sidebar).not.toContain('Run 详情')
    expect(sidebar).not.toContain('Runtime Diagnostics')
    expect(sidebar).not.toContain('run-detail')

    const workbench = renderToStaticMarkup(<SkillsCenterWorkbench />)
    expect(workbench).toContain('aria-label="搜索 Skills"')
    expect(workbench).toContain('aria-label="刷新 Skills Runtime"')
    expect(workbench).toContain('aria-label="Skills 面包屑"')
    expect(workbench).toContain('skills-runtime-page')
    expect(workbench).toContain('导入 Skill')
    expect(workbench).not.toContain('导入 Package')
    expect(workbench).not.toContain('Run 详情')
    expect(workbench).not.toContain('Runtime Diagnostics')
  })

  it('keeps status meaning in text and icon markup instead of color alone', () => {
    const workbench = renderToStaticMarkup(<SkillsCenterWorkbench />)
    expect(workbench).toContain('Runtime Healthy')
    expect(workbench).toContain('Package Runtime')
    expect(workbench).toMatch(/skills-status[^>]*>[^<]*<svg/)
  })
})
