import { describe, expect, it } from 'vitest'
import { prepareGapQueryCandidates } from './plan-iteration'

const candidate = {
  questionId: 'question-1',
  query: '企业级 AI 助手 局限 风险 独立评测',
  intent: 'counterevidence' as const,
  sourceTargets: ['独立研究与可信行业媒体'],
}

describe('prepareGapQueryCandidates', () => {
  it('blocks an already attempted equivalent query but keeps a new intent or unmet source target', () => {
    const existing = [
      { questionId: 'question-1', query: '企业级 AI 助手 局限 风险 独立评测', intent: 'counterevidence', sourceTargets: ['独立研究与可信行业媒体'] },
      { questionId: 'question-1', query: '企业级 AI 助手 官方资料', intent: 'primary_source', sourceTargets: ['公司官网'] },
    ]

    const plans = prepareGapQueryCandidates([
      candidate,
      { ...candidate, intent: 'recent_update', query: '企业级 AI 助手 最新发布 更新' },
      { ...candidate, sourceTargets: ['国家统计局'], query: '企业级 AI 助手 局限 风险 独立评测 site:gov.cn' },
    ], existing as any)

    expect(plans).toEqual([
      expect.objectContaining({ intent: 'recent_update' }),
      expect.objectContaining({ intent: 'counterevidence', sourceTargets: ['国家统计局'] }),
    ])
  })

  it('rejects policy diagnostics from a real search query', () => {
    expect(prepareGapQueryCandidates([
      { ...candidate, query: '企业级 AI 助手 Missing required evidence category: primary_source' },
    ], [])).toEqual([])
  })
})
