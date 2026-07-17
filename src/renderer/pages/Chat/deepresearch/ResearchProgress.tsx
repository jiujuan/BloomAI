import React from 'react'
import type { ResearchRunDto } from '@shared/deepresearch/contracts'

const PHASE_LABELS: Record<string, string> = {
  queued: '等待执行', planning: '规划问题', researching: '搜集证据', synthesizing: '撰写报告', verifying: '核验主张',
  awaiting_input: '等待补充信息', cancelling: '正在取消', completed: '已完成', completed_with_limitations: '已完成（有限制）',
  cancelled: '已取消', interrupted: '已中断', failed: '失败',
}

export function researchPhaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase
}

export function ResearchProgress({ run }: { run: ResearchRunDto }) {
  const progress = Math.max(0, Math.min(100, Math.round(run.progress)))
  return (
    <section className="research-progress" aria-label="研究进度">
      <div className="research-progress-heading">
        <div>
          <span className="research-progress-phase">{researchPhaseLabel(run.phase)}</span>
          <strong>{progress}%</strong>
        </div>
        <span className="research-status-badge" data-status={run.status}>{researchPhaseLabel(run.status)}</span>
      </div>
      <div className="research-progress-track" aria-label={'研究进度 ' + progress + '%'}>
        <span className="research-progress-value" style={{ width: progress + '%' }} />
      </div>
      <dl className="research-progress-stats">
        <div><dt>问题</dt><dd>{run.usage.questions}/{run.budget.maxQuestions}</dd></div>
        <div><dt>已检索</dt><dd>{run.usage.searchQueries}</dd></div>
        <div><dt>来源</dt><dd>{run.usage.normalizedSources}</dd></div>
        <div><dt>已抓取</dt><dd>{run.usage.fetchedSources}</dd></div>
      </dl>
    </section>
  )
}
