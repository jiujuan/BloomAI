import { describe, expect, it } from 'vitest'
import { moreNavigationItems, workspaceNavigationItems } from './WorkspaceSidebar'

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
