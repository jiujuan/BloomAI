import { describe, expect, it, vi } from 'vitest'
import { ArticleSourceError } from '../skills/article-illustrations/article-source'
import { createArticleIllustrationService } from './article-illustration.service'

const sourceInput = { source: { type: 'text' as const, text: 'article' }, mode: 'fallback' as const }

describe('ArticleIllustrationService facade', () => {
  it('converts ArticleSourceError into a stable ServiceError while preserving paste guidance', async () => {
    const service = createArticleIllustrationService({
      runtime: {
        createPlan: vi.fn(async () => { throw new ArticleSourceError('URL_NOT_ALLOWED', 'Private addresses are blocked') }),
      },
    } as any)

    await expect(service.createPlan(sourceInput)).rejects.toMatchObject({
      name: 'ServiceError',
      code: 'URL_NOT_ALLOWED',
      message: 'Private addresses are blocked',
      details: { canPasteText: true },
    })
  })

  it('converts known illustration-domain errors and hides unexpected failures', async () => {
    const known = createArticleIllustrationService({
      runtime: {
        confirmPlan: vi.fn(async () => { throw Object.assign(new Error('Select an enabled Package Skill'), { code: 'ELIGIBLE_SKILL_REQUIRED' }) }),
      },
    } as any)
    await expect(known.confirmPlan('job-1')).rejects.toMatchObject({ code: 'ELIGIBLE_SKILL_REQUIRED' })

    const unknown = createArticleIllustrationService({
      runtime: { confirmPlan: vi.fn(async () => { throw new Error('provider token=secret') }) },
    } as any)
    await expect(unknown.confirmPlan('job-1')).rejects.toMatchObject({
      code: 'ARTICLE_ILLUSTRATION_ERROR',
      message: 'Article illustration operation failed',
    })
  })

  it('converts missing jobs into the shared NOT_FOUND error', () => {
    const service = createArticleIllustrationService({ runtime: { getJob: vi.fn(() => undefined) } } as any)
    expect(() => service.getJob('missing')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
  })
})
