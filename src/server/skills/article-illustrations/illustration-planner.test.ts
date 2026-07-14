import { describe, expect, it } from 'vitest'
import { createIllustrationPlan, renderIllustrationMarkdown } from './illustration-planner'

describe('article illustration planner', () => {
  const text = [
    '# A thoughtful title',
    'First paragraph explains the opening context in a concrete way.',
    'Second paragraph introduces a team working through a challenge.',
    'Third paragraph describes the result and the next step.',
  ].join('\n\n')

  it('creates a deterministic, bounded editable scene plan', () => {
    const input = { text, imageCount: 3, style: 'editorial', aspectRatio: '16:9' }
    const first = createIllustrationPlan(input)
    expect(first).toHaveLength(3)
    expect(first).toEqual(createIllustrationPlan(input))
    expect(first[0]).toMatchObject({ ordinal: 1, title: 'A thoughtful title' })
    expect(first[0].prompt).toContain('editorial')
    expect(first[0].prompt).toContain('16:9')
    expect(createIllustrationPlan({ ...input, imageCount: 99 })).toHaveLength(12)
    expect(createIllustrationPlan({ ...input, imageCount: 0 })).toHaveLength(1)
  })

  it('renders a portable Markdown manifest', () => {
    const scenes = createIllustrationPlan({ text, imageCount: 1, style: 'editorial', aspectRatio: '1:1' })
    const markdown = renderIllustrationMarkdown({ id: 'job-1', source_label: 'Draft', source_url: null, mode: 'fallback', config: { model: 'model-a' } }, [{ ...scenes[0], status: 'completed', generation_id: 'gen-1' }])
    expect(markdown).toContain('# Article illustration plan')
    expect(markdown).toContain('Draft')
    expect(markdown).toContain('gen-1')
  })
})