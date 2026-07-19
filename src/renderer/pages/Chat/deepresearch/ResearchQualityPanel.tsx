import React from 'react'
import type { ResearchQualityDto, ResearchRunStatus } from '@shared/deepresearch/contracts'

function percent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`
}

const GATE_LABELS: Record<string, string> = {
  high_priority_coverage: '高优先级问题覆盖',
  factual_claim_citation_coverage: '事实主张引用覆盖',
  key_claim_citation_validity: '关键主张语义引用有效性',
  key_section_minimum_length: '关键章节长度',
  key_section_independent_domains: '关键章节独立来源',
  section_similarity: '章节重复度',
  required_source_type_or_disclosure: '必需来源类型或披露',
  citation_verification_capability: '语义引用验证能力',
  contradiction_disclosure: '矛盾证据披露',
  required_sections: '必需章节',
  research_deadline: '研究截止时间',
  unsupported_important_claims: '重要主张支持情况',
}

export function qualityGateLabel(ruleId: string): string {
  return GATE_LABELS[ruleId] ?? ruleId
}

export function ResearchQualityPanel({ quality, runStatus }: { quality: ResearchQualityDto | null; runStatus: ResearchRunStatus }) {
  if (!quality) return null

  const failedGates = quality.gateResults?.filter((gate) => !gate.passed) ?? []
  const isLimited = runStatus === 'completed_with_limitations' || quality.releaseStatus === 'completed_with_limitations'
  const isFailed = runStatus === 'failed' || quality.releaseStatus === 'failed'

  return <section className="research-section research-quality-panel" aria-labelledby="research-quality-heading">
    <div className="research-section-heading">
      <h3 id="research-quality-heading">研究质量与局限</h3>
      <span className="research-status-badge" data-status={quality.releaseStatus}>{quality.releaseStatus === 'completed' ? '质量门通过' : quality.releaseStatus === 'failed' ? '质量门失败' : '受限草稿'}</span>
    </div>
    {isLimited && <p className="deep-research-error" role="alert"><strong>受限草稿，不是正式发布的完整深度研究报告。</strong> 以下质量门未满足；请结合局限和修复建议使用。</p>}
    {isFailed && <p className="deep-research-error" role="alert"><strong>研究未通过正式发布质量门。</strong> 该结果不应作为完整深度研究报告使用。</p>}
    <dl className="research-progress-stats">
      <div><dt>高优先级覆盖</dt><dd>{percent(quality.highPriorityQuestionCoverage)}</dd></div>
      <div><dt>事实引用覆盖</dt><dd>{percent(quality.factualClaimCitationCoverage)}</dd></div>
      <div><dt>语义支持引用</dt><dd>{percent(quality.supportedCitationCoverage)}</dd></div>
      <div><dt>独立引用域名</dt><dd>{quality.independentCitedDomainCount}</dd></div>
    </dl>
    {failedGates.length > 0 && <ul className="research-question-list" aria-label="未通过的质量门">
      {failedGates.map((gate) => <li className="research-question-item" key={gate.ruleId}>
        <div className="research-question-row"><div className="research-question-copy"><strong>{qualityGateLabel(gate.ruleId)}</strong><span>当前值：{String(gate.actual)}；阈值：{gate.threshold === null ? '不适用' : String(gate.threshold)}</span></div><span className="research-status-badge" data-status="failed">未通过</span></div>
        <p className="research-question-gaps">建议：{gate.remedialAction}</p>
      </li>)}
    </ul>}
    {quality.limitations.length > 0 && <ul className="research-question-list" aria-label="研究局限">{quality.limitations.map((limitation, index) => <li className="research-question-item" key={`${index}:${limitation}`}><p className="research-question-gaps">局限：{limitation}</p></li>)}</ul>}
    {quality.remedialActions?.length ? <p className="research-question-gaps">下一步：{quality.remedialActions.join('；')}</p> : null}
  </section>
}