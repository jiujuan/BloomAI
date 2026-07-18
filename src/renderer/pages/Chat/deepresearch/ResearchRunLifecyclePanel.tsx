import React from 'react'
import type { ResearchLoopDecision, ResearchRunDto } from '@shared/deepresearch/contracts'
import type { DeepResearchLifecycle } from './deep-research.types'

const STATUS_LABELS: Record<ResearchRunDto['status'], string> = {
  queued: '排队中',
  planning: '规划中',
  researching: '研究中',
  assessing_coverage: '评估覆盖中',
  gap_filling: '补充研究中',
  synthesizing: '综合撰写中',
  verifying: '验证中',
  completed: '已完成',
  completed_with_limitations: '已完成（存在限制）',
  awaiting_input: '等待澄清',
  cancelling: '正在取消',
  cancelled: '已取消',
  interrupted: '已中断',
  failed: '失败',
}

const PHASE_LABELS: Record<string, string> = {
  queued: '排队',
  planning: '规划',
  researching: '研究',
  assessing_coverage: '覆盖评估',
  gap_filling: '补充研究',
  synthesizing: '综合撰写',
  verifying: '验证',
  finalizing: '收尾',
}

const STOP_REASON_LABELS: Record<ResearchLoopDecision, string> = {
  continue: '继续补充研究',
  stop_covered: '覆盖目标已达到',
  stop_budget: '预算已用尽',
  stop_no_material_gain: '没有实质性增益',
  stop_no_actionable_gaps: '没有可执行的覆盖缺口',
  stop_cancelled: '研究已取消',
  stop_max_iterations: '已达到最大迭代次数',
  stop_blocked: '存在不可恢复的阻塞',
}

function redactLifecycleText(value: string): string {
  const redacted = value
    .replace(/https?:\/\/[^\s)\]}]+/gi, '[链接已隐藏]')
    .replace(/(?:[a-z]:\\|\\\\)[^\s,;\])}]+/gi, '[路径已隐藏]')
    .replace(/\b(token|secret|password|authorization|cookie)\s*[=:]\s*[^\s,;\])}]+/gi, '$1=[已隐藏]')
  return redacted.trim() || '已隐藏敏感信息'
}

function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? '处理中'
}

function failureLabel(run: ResearchRunDto): string {
  if (run.status !== 'failed') return STATUS_LABELS[run.status]
  return run.error?.retryable ? '失败（可恢复）' : '失败（不可恢复）'
}

export interface ResearchRunLifecyclePanelProps {
  run: ResearchRunDto
  lifecycle: DeepResearchLifecycle
  loading: boolean
  onCancel: () => void
  onResume: () => void
}

/**
 * A deliberately isolated projection of the public lifecycle DTO.  It renders
 * only allow-listed lifecycle fields and delegates actions to the store/API.
 */
export function ResearchRunLifecyclePanel({ run, lifecycle, loading, onCancel, onResume }: ResearchRunLifecyclePanelProps) {
  if (!lifecycle) return null

  const { currentAttempt, resumeCheckpoint, assessment, budget, stopReason, limitations, cancellation, capabilities } = lifecycle
  const activeIteration = lifecycle.iterationHistory.items.find((iteration) => iteration.status === 'executing' || iteration.status === 'planned')
  const showCancel = capabilities.canCancel
  const showResume = capabilities.canResume && run.status !== 'cancelled'
  const showRetry = capabilities.canRetry
  const renderedLimitations = limitations.map(redactLifecycleText)

  return <section className="research-section research-run-lifecycle" aria-labelledby="research-lifecycle-heading">
    <div className="research-section-heading"><h3 id="research-lifecycle-heading">研究生命周期</h3><span>{failureLabel(run)}</span></div>
    <dl className="research-progress-stats">
      <div><dt>阶段</dt><dd>{phaseLabel(run.phase)}</dd></div>
      {currentAttempt && <div><dt>当前尝试</dt><dd>尝试 #{currentAttempt.ordinal}（{currentAttempt.status}）</dd></div>}
      {activeIteration && <div><dt>补充迭代</dt><dd>第 {activeIteration.ordinal} 轮</dd></div>}
      <div><dt>预算</dt><dd>已使用迭代 {budget.usage.iterations} / {budget.limit.maxIterations}</dd></div>
      <div><dt>检索预算</dt><dd>{budget.usage.searchQueries} / {budget.limit.maxSearchQueries}</dd></div>
      <div><dt>抓取预算</dt><dd>{budget.usage.fetchedSources} / {budget.limit.maxFetchedSources}</dd></div>
      {assessment && <div><dt>覆盖评估</dt><dd>{Math.round(assessment.aggregateScore * 100)}%</dd></div>}
      {resumeCheckpoint && <div><dt>恢复游标</dt><dd>{resumeCheckpoint.resumeCursor.nextPhase}</dd></div>}
      {stopReason && <div><dt>停止原因</dt><dd>{STOP_REASON_LABELS[stopReason.decision]}</dd></div>}
    </dl>
    {run.status === 'cancelling' && <p className="research-lifecycle-notice">取消请求已持久化，正在安全停止当前工作。</p>}
    {run.status === 'cancelled' && <p className="research-lifecycle-notice">该研究已取消，不能恢复。</p>}
    {run.status === 'interrupted' && resumeCheckpoint && <p className="research-lifecycle-notice">可从恢复游标：{resumeCheckpoint.resumeCursor.nextPhase} 继续。</p>}
    {cancellation?.requestedAt && run.status !== 'cancelled' && run.status !== 'cancelling' && <p className="research-lifecycle-notice">已记录取消请求。</p>}
    {renderedLimitations.length > 0 && <div className="research-lifecycle-limitations"><h4>限制条件</h4><ul>{renderedLimitations.map((limitation, index) => <li key={`${index}:${limitation}`}>{limitation}</li>)}</ul></div>}
    <div className="deep-research-run-actions" aria-label="研究生命周期操作">
      {showCancel && <button type="button" disabled={loading || run.status === 'cancelling'} onClick={onCancel}>取消研究</button>}
      {showResume && <button type="button" disabled={loading} onClick={onResume}>恢复研究</button>}
      {showRetry && <button type="button" disabled={loading} onClick={onResume}>重试研究</button>}
    </div>
  </section>
}