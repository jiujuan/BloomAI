import { describe, expect, it } from 'vitest'
import { articleExecutionTabs, articleSourceTabs } from './ArticleIllustrationWorkbench'

describe('article illustration tab configuration', () => {
  it('exposes only text and file article source tabs in Chinese', () => {
    expect(articleSourceTabs).toEqual([
      { id: 'text', label: '文章文本' },
      { id: 'file', label: '上传文件' },
    ])
  })

  it('exposes Chinese Skill-first and fallback generation tabs', () => {
    expect(articleExecutionTabs).toEqual([
      { id: 'skill', label: 'Skill 优先' },
      { id: 'fallback', label: '现有模型兜底' },
    ])
  })
})
