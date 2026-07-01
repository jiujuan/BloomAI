import { describe, expect, it } from 'vitest'
import { buildWriterInstructions, normalizeWriting } from './writer-prompt'

describe('normalizeWriting', () => {
  it('drops an unknown type', () => {
    expect(normalizeWriting({ type: 'poem', params: { style: '正式' } })).toBeUndefined()
    expect(normalizeWriting(undefined)).toBeUndefined()
    expect(normalizeWriting(null)).toBeUndefined()
  })

  it('keeps only whitelisted param keys and values for the type', () => {
    const cfg = normalizeWriting({
      type: 'general',
      params: { platform: '知乎', style: '幽默', words: '9999', bogus: 'x' },
    })
    // words=9999 is not an allowed option; platform key belongs to general; bogus is unknown.
    expect(cfg).toEqual({ type: 'general', params: { platform: '知乎', style: '幽默' } })
  })

  it('rejects a value that belongs to a different type', () => {
    // 4000 is a work-summary word count, not valid for xiaohongshu (caps at 500).
    const cfg = normalizeWriting({ type: 'xiaohongshu', params: { words: '4000', scene: '美食攻略' } })
    expect(cfg).toEqual({ type: 'xiaohongshu', params: { scene: '美食攻略' } })
  })

  it('ignores non-string param values', () => {
    const cfg = normalizeWriting({ type: 'general', params: { words: 500 } })
    expect(cfg).toEqual({ type: 'general', params: {} })
  })
})

describe('buildWriterInstructions', () => {
  it('falls back to a generic prompt when no config is supplied', () => {
    const out = buildWriterInstructions(undefined)
    expect(out).toContain('自适应写作')
    expect(out).not.toContain('目标字数')
  })

  it('embeds the chosen parameters as Chinese constraints', () => {
    const out = buildWriterInstructions({
      type: 'xiaohongshu',
      params: { scene: '美食攻略', style: '种草转化', words: '300' },
    })
    expect(out).toContain('小红书风格文案')
    expect(out).toContain('场景：美食攻略。')
    expect(out).toContain('风格：种草转化。')
    expect(out).toContain('目标字数约 300 字（允许 ±15%）。')
  })

  it('labels a platform field specially and skips unset params', () => {
    const out = buildWriterInstructions({ type: 'general', params: { platform: '公众号' } })
    expect(out).toContain('发布平台：公众号，遵循该平台的排版与调性习惯。')
    expect(out).not.toContain('目标字数') // words not chosen → omitted
  })
})
