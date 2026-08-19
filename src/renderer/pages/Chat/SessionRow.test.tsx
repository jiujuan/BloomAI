import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/schemas'
import { canSaveSessionTitle, normalizeSessionTitleInput, SessionRow } from './SessionRow'

const session: Session = {
  id: 'session-1',
  title: '项目分析聊天',
  persona_id: null,
  model: 'test-model',
  status: 'idle',
  project_id: 'project-1',
  created_at: 1_700_000_000_000,
  updated_at: 1_699_985_600_000,
}

describe('session title editing helpers', () => {
  it('trims session titles before saving', () => {
    expect(normalizeSessionTitleInput('  产品方案讨论  ')).toBe('产品方案讨论')
  })

  it('does not allow blank session titles to be saved', () => {
    expect(canSaveSessionTitle('   ')).toBe(false)
    expect(canSaveSessionTitle('新标题')).toBe(true)
  })
})

describe('SessionRow metadata', () => {
  it('shows local project metadata and relative update time', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    try {
      const markup = renderToStaticMarkup(<SessionRow session={session} isActive={false} onSelect={() => undefined} />)
      expect(markup).toContain('项目分析聊天')
      expect(markup).toContain('本地')
      expect(markup).toContain('4小时前')
    } finally {
      vi.restoreAllMocks()
    }
  })
})
