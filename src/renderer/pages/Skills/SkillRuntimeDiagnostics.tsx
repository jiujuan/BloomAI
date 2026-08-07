import React from 'react'
import { Activity, AlertTriangle, CheckCircle2, CircleOff, Database, ListOrdered, RefreshCw, Server, ShieldCheck } from 'lucide-react'
import type { SkillRuntimeDiagnosticsSnapshot } from '@renderer/pages/Skills/skill-runtime.types'
import { cn } from '@renderer/utils'

type Props = {
  diagnostics: SkillRuntimeDiagnosticsSnapshot | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}

type RuntimeStatus = 'ready' | 'degraded' | 'disabled'

const statusMeta: Record<RuntimeStatus, { label: string; tone: string; Icon: typeof CheckCircle2 }> = {
  ready: { label: 'Ready', tone: 'success', Icon: CheckCircle2 },
  degraded: { label: 'Degraded', tone: 'warning', Icon: AlertTriangle },
  disabled: { label: 'Disabled', tone: 'muted', Icon: CircleOff },
}

function deriveRuntimeStatus(diagnostics: SkillRuntimeDiagnosticsSnapshot): RuntimeStatus {
  if (diagnostics.health.status === 'disabled') return 'disabled'
  if (diagnostics.health.status === 'ready' && diagnostics.health.readiness) return 'ready'
  const runtimeCheck = diagnostics.health.checks.find((check) => check.name === 'runtime')
  return runtimeCheck?.status === 'failed' ? 'disabled' : 'degraded'
}

function displayValue(value: string | number | null | undefined, fallback = '—') {
  return value === null || value === undefined || value === '' ? fallback : String(value)
}

function checkTone(status: string) {
  if (status === 'ok') return 'ok'
  if (status === 'warning') return 'warning'
  return 'failed'
}

function StatusBadge({ status }: { status: RuntimeStatus }) {
  const { label, tone, Icon } = statusMeta[status]
  return <span className={cn('skills-runtime-status', tone)} role="status" aria-label={`Runtime status: ${label}`}>
    <Icon size={13} aria-hidden="true" />
    <span>{label}</span>
  </span>
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="skills-runtime-metric"><span>{label}</span><strong>{value}</strong></div>
}

export function SkillRuntimeDiagnostics({ diagnostics, loading, error, onRefresh }: Props) {
  const status = diagnostics ? deriveRuntimeStatus(diagnostics) : null
  return <section className="skills-runtime-diagnostics" aria-labelledby="skill-runtime-diagnostics-title">
    <header className="skills-runtime-diagnostics-head">
      <div>
        <div className="skills-eyebrow"><Activity size={14} aria-hidden="true" /> Runtime</div>
        <h2 id="skill-runtime-diagnostics-title">Runtime Diagnostics</h2>
        <p>运行状态、队列、迁移和策略的只读摘要。</p>
      </div>
      <button type="button" className="skills-button" onClick={onRefresh} disabled={loading}>
        <RefreshCw size={14} aria-hidden="true" />
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </header>

    {error && <div className="skills-message danger" role="alert">无法加载 Runtime Diagnostics。</div>}
    {loading && !diagnostics && <div className="skills-center-state" role="status">正在加载 Runtime Diagnostics…</div>}
    {!loading && !diagnostics && !error && <div className="skills-center-state">暂无 Runtime Diagnostics 数据。</div>}

    {diagnostics && <div className="skills-runtime-diagnostics-grid">
      <section className="skills-runtime-diagnostics-card" aria-labelledby="runtime-health-title">
        <div className="skills-runtime-card-title"><Activity size={15} aria-hidden="true" /><h3 id="runtime-health-title">Runtime Health</h3>{status && <StatusBadge status={status} />}</div>
        <div className="skills-runtime-metrics">
          <Metric label="Liveness" value={diagnostics.health.liveness ? 'Healthy' : 'Unavailable'} />
          <Metric label="Readiness" value={diagnostics.health.readiness ? 'Ready' : 'Not ready'} />
          <Metric label="Checks" value={diagnostics.health.checks.length} />
        </div>
        <ul className="skills-runtime-check-list">
          {diagnostics.health.checks.map((check) => <li key={check.name}><span>{check.name}</span><span className={cn('skills-runtime-check', checkTone(check.status))}>{check.status}</span></li>)}
        </ul>
      </section>

      <section className="skills-runtime-diagnostics-card" aria-labelledby="runtime-worker-title">
        <div className="skills-runtime-card-title"><Server size={15} aria-hidden="true" /><h3 id="runtime-worker-title">Worker</h3></div>
        <div className="skills-runtime-metrics">
          <Metric label="Status" value={displayValue(diagnostics.worker.status)} />
          <Metric label="Worker ID" value={displayValue(diagnostics.worker.workerId)} />
          <Metric label="Active Runs" value={displayValue(diagnostics.worker.activeRuns, '0')} />
          <Metric label="Concurrency" value={displayValue(diagnostics.worker.concurrency, '—')} />
        </div>
      </section>

      <section className="skills-runtime-diagnostics-card" aria-labelledby="runtime-queue-title">
        <div className="skills-runtime-card-title"><ListOrdered size={15} aria-hidden="true" /><h3 id="runtime-queue-title">Queue Backlog</h3></div>
        <div className="skills-runtime-metrics">
          <Metric label="Depth" value={diagnostics.queue.depth} />
          <Metric label="Queued" value={diagnostics.queue.queued} />
          <Metric label="Leased" value={diagnostics.queue.leased} />
          <Metric label="Retry wait" value={diagnostics.queue.retryWait} />
          <Metric label="Dead" value={diagnostics.queue.dead} />
          <Metric label="Lag" value={`${diagnostics.queue.lagMs} ms`} />
        </div>
      </section>

      <section className="skills-runtime-diagnostics-card" aria-labelledby="runtime-migration-title">
        <div className="skills-runtime-card-title"><Database size={15} aria-hidden="true" /><h3 id="runtime-migration-title">Migration</h3></div>
        <div className="skills-runtime-metrics">
          <Metric label="Current" value={displayValue(diagnostics.migration.current)} />
          <Metric label="Applied" value={diagnostics.migration.applied.length} />
          <Metric label="Pending" value={diagnostics.migration.pending.length} />
        </div>
      </section>

      <section className="skills-runtime-diagnostics-card" aria-labelledby="runtime-policy-title">
        <div className="skills-runtime-card-title"><ShieldCheck size={15} aria-hidden="true" /><h3 id="runtime-policy-title">Policy</h3></div>
        <div className="skills-runtime-metrics">
          <Metric label="Policy version" value={displayValue(diagnostics.policy.version)} />
          <Metric label="Config version" value={displayValue(diagnostics.policy.configVersion)} />
        </div>
      </section>

      <section className="skills-runtime-diagnostics-card" aria-labelledby="runtime-failures-title">
        <div className="skills-runtime-card-title"><AlertTriangle size={15} aria-hidden="true" /><h3 id="runtime-failures-title">Recent Failures</h3></div>
        {diagnostics.recentFailures.length === 0 ? <p className="skills-runtime-empty">No recent failures.</p> : <ul className="skills-runtime-failure-list">
          {diagnostics.recentFailures.map((failure, index) => <li key={`${failure.runId || 'failure'}-${index}`}>
            <strong>{displayValue(failure.status, 'Failed')}</strong>
            <span>{displayValue(failure.errorCode, 'Unknown error')}</span>
            {failure.runId && <small>Run {failure.runId}</small>}
          </li>)}
        </ul>}
      </section>
    </div>}
  </section>
}
