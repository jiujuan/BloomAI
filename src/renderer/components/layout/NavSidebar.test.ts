import { describe, expect, it } from 'vitest'
import { mainNavigationItems } from './NavSidebar'

describe('mainNavigationItems', () => {
  it('exposes the workspace navigation through the legacy export', () => {
    expect(mainNavigationItems.map((item) => item.label)).toEqual([
      '新建聊天',
      '项目',
      '技能',
      'AI 画图',
      '定时任务',
      '更多...',
    ])
  })
})
