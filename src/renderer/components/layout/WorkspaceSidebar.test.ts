import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
  MAX_WORKSPACE_SIDEBAR_WIDTH,
  MIN_WORKSPACE_SIDEBAR_WIDTH,
  clampWorkspaceSidebarWidth,
  getWorkspaceSidebarWidthFromPointer,
  moreNavigationItems,
  workspaceNavigationItems,
} from './WorkspaceSidebar'

describe('workspace sidebar sizing', () => {
  it('uses a 300px default width with safe resize bounds', () => {
    expect(DEFAULT_WORKSPACE_SIDEBAR_WIDTH).toBe(300)
    expect(MIN_WORKSPACE_SIDEBAR_WIDTH).toBeLessThan(DEFAULT_WORKSPACE_SIDEBAR_WIDTH)
    expect(MAX_WORKSPACE_SIDEBAR_WIDTH).toBeGreaterThan(DEFAULT_WORKSPACE_SIDEBAR_WIDTH)
  })

  it('clamps pointer resizing to the supported width range', () => {
    expect(getWorkspaceSidebarWidthFromPointer(300, 100, 148)).toBe(348)
    expect(getWorkspaceSidebarWidthFromPointer(300, 100, -100)).toBe(MIN_WORKSPACE_SIDEBAR_WIDTH)
    expect(getWorkspaceSidebarWidthFromPointer(300, 100, 400)).toBe(MAX_WORKSPACE_SIDEBAR_WIDTH)
    expect(clampWorkspaceSidebarWidth(Number.NaN)).toBe(DEFAULT_WORKSPACE_SIDEBAR_WIDTH)
  })
})

describe('workspace sidebar navigation', () => {
  it('keeps the six top-level entries in the requested order', () => {
    expect(workspaceNavigationItems.map((item) => item.label)).toEqual([
      '新建聊天',
      '项目',
      '技能',
      'AI 画图',
      '定时任务',
      '更多...',
    ])
  })

  it('keeps the requested more menu entries and page mappings', () => {
    expect(moreNavigationItems.map(({ label, page }) => ({ label, page }))).toEqual([
      { label: 'MCP Servers', page: 'mcp-servers' },
      { label: '文章配图', page: 'article-illustration' },
      { label: 'Personas', page: 'personas' },
      { label: 'Tools', page: 'tools' },
    ])
  })
})
