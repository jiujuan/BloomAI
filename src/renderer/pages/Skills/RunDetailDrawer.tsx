import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileOutput, LoaderCircle, Play, X } from 'lucide-react'
import { useSkillRuntimeStore } from './skill-runtime.store'
import { ArtifactList } from './ArtifactList'
import { CapabilityApprovalCard } from './CapabilityApprovalCard'
import { RunActionPanel } from './RunActionPanel'
import { RunEventStream } from './RunEventStream'
import { RunTimeline } from './RunTimeline'
import { formatDate } from './skill-runtime.types'
import type { RunAction, SkillArtifact, SkillRun, SkillVersion } from './skill-runtime.types'

export function RunSkillDialog({ version, onClose, onStarted }: { version: SkillVersion; onClose: () => void; onStarted: (runId: string) => void }) {
  const { startRun } = useSkillRuntimeStore()
  const [input, setInput] = useState('{}')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const start = async () => {
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(input) as Record<string, unknown>; if (Array.isArray(parsed) || !parsed) throw new Error('') } catch { setError('输入必须是 JSON 对象。'); return }
    setBusy(true); setError(null)
    try { const run = await startRun({ skillVersionId: version.id, input: parsed }); onStarted(run.id); onClose() } catch (cause) { setError(cause instanceof Error ? cause.message : '无法创建运行。') } finally { setBusy(false) }
  }
  return <div className="skills-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="skills-modal skills-run-modal" role="dialog" aria-modal="true" aria-labelledby="run-skill-title" onMouseDown={(event) => event.stopPropagation()}><header className="skills-modal-head"><div><div className="skills-eyebrow"><Play size={14} />调试运行</div><h2 id="run-skill-title">运行 {version.version}</h2></div><button className="skills-icon-button" onClick={onClose} aria-label="关闭运行窗口"><X size={16} /></button></header><div className="skills-modal-body"><p className="skills-muted">此入口面向高级用户。输入会被运行时汇总记录，不会在事件中保留敏感数据。</p><label className="skills-field"><span>运行输入（JSON 对象）</span><textarea className="skills-code-input" value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} /></label>{error && <div className="skills-message error"><AlertTriangle size={15} />{error}</div>}</div><footer className="skills-modal-foot"><button className="skills-button secondary" onClick={onClose}>取消</button><button className="skills-button primary" onClick={start} disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />}开始运行</button></footer></section></div>
}

export function RunDetailDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const runtime = useSkillRuntimeStore()
  const { selectedRun, eventsByRun, runEvents, artifactsByRun, runArtifacts, runCapabilitiesByRun, loadRun, loadRunEvents, loadRunCapabilities, loadArtifacts, subscribeRunEvents, stopRunEvents, dispatchCommand, exportArtifact } = runtime
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = selectedRun?.id === runId ? selectedRun : null
  const events = useMemo(() => eventsByRun[runId] ?? (run?.id === runId ? runEvents : []), [eventsByRun, run?.id, runEvents, runId])
  const artifacts = useMemo(() => artifactsByRun[runId] ?? (run?.id === runId ? runArtifacts : []), [artifactsByRun, run?.id, runArtifacts, runId])
  const capabilities = runCapabilitiesByRun[runId] ?? []

  useEffect(() => {
    let active = true
    let closeStream: () => void = () => undefined
    Promise.all([loadRun(runId), loadRunEvents(runId), loadRunCapabilities(runId), loadArtifacts(runId)])
      .then(() => { if (active) closeStream = subscribeRunEvents(runId) })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '加载运行详情失败。') })
    return () => { active = false; closeStream(); stopRunEvents(runId) }
  }, [loadArtifacts, loadRun, loadRunCapabilities, loadRunEvents, runId, stopRunEvents, subscribeRunEvents])

  const handleAction = async (action: RunAction) => {
    setBusy(true); setError(null)
    try { await dispatchCommand(runId, action) } catch (cause) { setError(cause instanceof Error ? cause.message : '无法更新运行。') } finally { setBusy(false) }
  }
  const exportRunArtifact = async (artifact: SkillArtifact) => {
    const destinationDir = typeof window !== 'undefined' ? window.prompt('输入导出目录（服务端会校验权限）：', '')?.trim() : ''
    if (!destinationDir || (typeof window !== 'undefined' && !window.confirm(`确认导出 ${artifact.path} 到 ${destinationDir}？此操作会记录审计事件。`))) return
    setBusy(true); setError(null)
    try { await exportArtifact(artifact.id, { runId, destinationDir, confirmed: true, auditReason: 'Exported from Run detail' }) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Artifact 导出失败。') } finally { setBusy(false) }
  }

  return <aside className="skills-drawer skills-run-drawer" aria-label="Skill Run 详情"><header className="skills-drawer-head"><div><div className="skills-eyebrow">Run</div><h2>{run ? run.status : '加载运行详情'}</h2><p>{run ? '更新于 ' + formatDate(run.updatedAt) : '正在读取事件与产物'}</p></div><button className="skills-icon-button" onClick={onClose} aria-label="关闭运行详情"><X size={16} /></button></header><div className="skills-drawer-scroll">{error && <div className="skills-message error"><AlertTriangle size={15} />{error}</div>}{!run ? <div className="skills-loading"><LoaderCircle className="spin" size={18} />正在加载 Run…</div> : <>
    <RunOverview run={run} capabilities={capabilities.length} />
    {run.status === 'waiting_approval' && run.requiredAction && <CapabilityApprovalCard action={run.requiredAction} />}
    {(run.supportedActions?.length || run.status === 'waiting_approval' || run.status === 'waiting_input' || run.status === 'failed') ? <RunActionPanel run={run} onAction={handleAction} busy={busy} /> : null}
    <RunTimeline events={events} />
    <RunEventStream events={events} live={Boolean(run && !isTerminal(run.status))} onReconnect={() => { void loadRunEvents(runId) }} />
    <RunCapabilityCalls run={run} />
    <RunInputOutput run={run} />
    <ArtifactList runId={run.id} artifacts={artifacts} onExport={exportRunArtifact} />
  </>}</div></aside>
}

function RunOverview({ run, capabilities }: { run: SkillRun; capabilities: number }) {
  const budget = run.budget
  return <section className="skills-detail-section" aria-labelledby="run-overview-title"><div className="skills-detail-heading"><h3 id="run-overview-title">Run 基本信息</h3><span className={'skills-status ' + statusTone(run.status)}>{run.status}</span></div><dl className="skills-detail-kv"><div><dt>Run ID</dt><dd className="skills-mono">{run.id}</dd></div><div><dt>Skill Version</dt><dd>{run.version?.version ?? run.skillVersionId}</dd></div><div><dt>Source</dt><dd>{run.version?.source ?? run.source ?? '—'}</dd></div><div><dt>入口</dt><dd>{run.surface || 'skills'}</dd></div><div><dt>开始时间</dt><dd>{formatDate(run.startedAt)}</dd></div><div><dt>完成时间</dt><dd>{formatDate(run.finishedAt)}</dd></div><div><dt>预算</dt><dd>{budget ? `${budget.used ?? 0} / ${budget.limit ?? '∞'} ${budget.unit ?? ''}` : '—'}</dd></div><div><dt>Capability grants</dt><dd>{capabilities}</dd></div></dl>{run.errorMessage && <div className="skills-message error"><AlertTriangle size={15} />{run.errorMessage}</div>}</section>
}

function RunCapabilityCalls({ run }: { run: SkillRun }) {
  const calls = run.capabilityCalls ?? []
  return <section className="skills-detail-section" aria-labelledby="run-capability-calls-title"><div className="skills-detail-heading"><h3 id="run-capability-calls-title">Capability calls</h3><FileOutput size={15} aria-hidden="true" /></div>{calls.length === 0 ? <p className="skills-muted">暂无能力调用记录。</p> : <div className="skills-grant-list">{calls.map((call) => <div className="skills-grant" key={call.id}><div><strong>{call.capability}</strong><p>{call.status} · {safeJson(call.scope)}</p></div><span className="skills-status info">{call.id}</span></div>)}</div>}</section>
}

function RunInputOutput({ run }: { run: SkillRun }) {
  return <section className="skills-detail-section" aria-labelledby="run-input-output-title"><div className="skills-detail-heading"><h3 id="run-input-output-title">Input / output summary</h3></div><div className="skills-field-grid"><div><span className="skills-eyebrow">Input</span><pre className="skills-code-block">{safeJson(run.inputSummary ?? summarizeRecord(run.input))}</pre></div><div><span className="skills-eyebrow">Output</span><pre className="skills-code-block">{safeJson(run.outputSummary ?? summarizeRecord(run.output ?? {}))}</pre></div></div>{run.resultSummary && <p className="skills-muted">{run.resultSummary}</p>}</section>
}

function summarizeRecord(value: Record<string, unknown>) { return Object.fromEntries(Object.keys(value).slice(0, 20).map((key) => [key, /(secret|token|password|api[_-]?key)/i.test(key) ? '[redacted]' : value[key]])) }
function safeJson(value: unknown) { try { return JSON.stringify(value, null, 2) } catch { return '{}' } }
function isTerminal(status: string) { return ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(status) }
function statusTone(status: string) { if (status === 'completed') return 'success'; if (status === 'failed' || status === 'cancelled') return 'danger'; if (status.startsWith('waiting')) return 'warning'; return 'info' }
