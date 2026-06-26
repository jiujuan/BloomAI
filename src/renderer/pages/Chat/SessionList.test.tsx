import { describe, expect, it } from 'vitest'
import { canSaveSessionTitle, normalizeSessionTitleInput } from './SessionList'

describe('session title editing helpers', () => {
  it('trims session titles before saving', () => {
    expect(normalizeSessionTitleInput('  产品方案讨论  ')).toBe('产品方案讨论')
  })

  it('does not allow blank session titles to be saved', () => {
    expect(canSaveSessionTitle('   ')).toBe(false)
    expect(canSaveSessionTitle('新标题')).toBe(true)
  })
})
