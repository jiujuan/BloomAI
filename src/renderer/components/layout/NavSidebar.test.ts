import { describe, expect, it } from 'vitest'
import { mainNavigationItems } from './NavSidebar'

describe('mainNavigationItems', () => {
  it('places article illustration immediately after AI image generation', () => {
    expect(mainNavigationItems.map((item) => ({ id: item.id, label: item.label }))).toEqual([
      { id: 'chat', label: 'Chat' },
      { id: 'image', label: 'AI 画图' },
      { id: 'article-illustration', label: '文章配图' },
      { id: 'tools', label: 'Tools' },
      { id: 'skills', label: 'Skills' },
      { id: 'personas', label: 'Personas' },
    ])
  })
})