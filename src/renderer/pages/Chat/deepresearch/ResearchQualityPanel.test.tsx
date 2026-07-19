import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ResearchQualityDto } from '@shared/deepresearch/contracts'
import { ResearchQualityPanel, qualityGateLabel } from './ResearchQualityPanel'

const quality: ResearchQualityDto = {
  releaseStatus: 'completed_with_limitations',
  highPriorityQuestionCoverage: 0.5,
  factualClaimCitationCoverage: 0.8,
  supportedCitationCoverage: 0.75,
  independentCitedDomainCount: 2,
  contradictionDisclosureCoverage: 1,
  requiredSectionCoverage: 1,
  limitations: ['缺少独立一手来源。'],
  assessorVersion: 'v3',
  gateResults: [{ ruleId: 'high_priority_coverage', actual: 0.5, threshold: 0.8, passed: false, blocking: true, affectedIds: ['question-1'], remedialAction: '补充独立一手来源。' }],
  remedialActions: ['补充独立一手来源。'],
}

describe('ResearchQualityPanel', () => {
  it('marks completed_with_limitations as a limited draft and renders actionable gates', () => {
    const markup = renderToStaticMarkup(<ResearchQualityPanel quality={quality} runStatus="completed_with_limitations" />)
    expect(markup).toContain('受限草稿，不是正式发布的完整深度研究报告。')
    expect(markup).toContain('高优先级问题覆盖')
    expect(markup).toContain('当前值：0.5；阈值：0.8')
    expect(markup).toContain('补充独立一手来源。')
  })

  it('keeps unknown gate identifiers safely readable', () => {
    expect(qualityGateLabel('custom_policy_rule')).toBe('custom_policy_rule')
  })
})