import { describe, expect, it } from 'vitest'
import { mainNavigationItems } from './NavSidebar'

describe('mainNavigationItems', () => {
  it('places Tools at the bottom of the main navigation', () => {
    expect(mainNavigationItems.map((item) => ({ id: item.id, label: item.label }))).toEqual([
      { id: 'chat', label: 'Chat' },
      { id: 'image', label: 'AI 画图' },
      { id: 'article-illustration', label: '文章配图' },
      { id: 'mcp-servers', label: 'MCP Servers' },
      { id: 'skills', label: 'Skills' },
      { id: 'schedules', label: '定时任务' },
      { id: 'personas', label: 'Personas' },
      { id: 'tools', label: 'Tools' },
    ])
  })
})
