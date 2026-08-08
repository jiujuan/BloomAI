import React, { useMemo, useState } from 'react'
import { Activity, CheckCircle2, CircleHelp, Clock3, Info, PauseCircle, Play, Search, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { SkillRun } from './skill-runtime.types'

export type RunStatusTone = 'success' | 'warning' | 'danger' | 'info' | 'muted'
export type RunStatusView = { label: string; tone: RunStatusTone; icon: LucideIcon }

const RUN_STATUS_VIEWS: Record<string, RunStatusView> = {
  created: { label: '排队中', tone: 'muted', icon: Clock3 },
  validating: { label: '校验中', tone: 'info', icon: Activity },
  running: { label: '运行中', tone: 'info', icon: Play },
  waiting_input: { label: '等待输入', tone: 'warning', icon: Clock3 },
  waiting_approval: { label: '等待审批', tone: 'warning', icon: Clock3 },
  completed: { label: '成功', tone: 'success', icon: CheckCircle2 },
  succeeded: { label: '成功', tone: 'success', icon: CheckCircle2 },
  completed_with_errors: { label: '完成（有错误）', tone: 'warning', icon: Info },
  failed: { label: '失败', tone: 'danger', icon: Info },
  cancelled: { label: '已取消', tone: 'muted', icon: PauseCircle },
  interrupted: { label: '已取消', tone: 'muted', icon: PauseCircle },
}

const DEFAULT_RUN_STATUS_VIEW: RunStatusView = { label: '未知状态', tone: 'muted', icon: CircleHelp }

export function getRunStatusView(status: string | null | undefined): RunStatusView {
  return RUN_STATUS_VIEWS[String(status || '').toLowerCase()] ?? DEFAULT_RUN_STATUS_VIEW
}

export function formatRunDuration(run: Pick<SkillRun, 'startedAt' | 'finishedAt' | 'updatedAt'>, now = Date.now()): string {
  const start = typeof run.startedAt === 'number' ? run.startedAt : run.updatedAt
  const end = typeof run.finishedAt === 'number' ? run.finishedAt : now
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—'
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000))
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes === 0 ? `${hours} 小时` : `${hours} 小时 ${remainingMinutes} 分`
}

export function getRunArtifactCount(runId: string, artifactsByRun: Record<string, unknown[] | undefined>): number {
  return artifactsByRun[runId]?.length ?? 0
}

export function RunStatusBadge({ status }: { status: string | null | undefined }) {
  const view = getRunStatusView(status)
  const Icon = view.icon
  return <span className={`skills-status skills-status-badge skills-run-status-badge ${view.tone}`} data-run-status={status || 'unknown'}>
    <Icon size={12} aria-hidden="true" /><span>{view.label}</span>
  </span>
}

export type RunsFilterState = { query: string; status: string; source: string }

export function filterSkillRuns(runs: SkillRun[], filters: RunsFilterState): SkillRun[] {
  const query = filters.query.trim().toLowerCase()
  const source = filters.source.trim().toLowerCase()
  return runs.filter((run) => {
    const sourceLabel = String(run.source || run.version?.source || '').toLowerCase()
    const searchable = [run.id, run.skillVersionId, run.version?.id, run.version?.version, run.version?.source, run.source, run.surface]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase())
    const matchesQuery = !query || searchable.some((value) => value.includes(query))
    const matchesStatus = filters.status === 'all' || run.status === filters.status
    const matchesSource = source === 'all' || sourceLabel.includes(source)
    return matchesQuery && matchesStatus && matchesSource
  })
}

type RunsWorkbenchProps = {
  runs: SkillRun[]
  artifactCounts?: Record<string, number>
  loading?: boolean
  error?: string | null
  onOpenRun: (runId: string) => void
  onRefresh?: () => void
}

export function RunsWorkbench({ runs, artifactCounts = {}, loading = false, error = null, onOpenRun, onRefresh }: RunsWorkbenchProps) {
  const [filters, setFilters] = useState<RunsFilterState>({ query: '', status: 'all', source: 'all' })
  const filteredRuns = useMemo(() => filterSkillRuns(runs, filters), [filters, runs])
  return <section className="skills-center-panel skills-runs-workbench" aria-labelledby="skills-runs-workbench-title">
    <div className="skills-center-panel-head">
      <div><div className="skills-eyebrow"><Activity size={14} aria-hidden="true" /> Observe / Runtime</div><h2 id="skills-runs-workbench-title">运行记录</h2><p>按 Run ID、Skill、状态、来源筛选；Run 状态、持续时间和 Artifact 数量保持可追溯。</p></div>
      {onRefresh && <button type="button" className="skills-button" onClick={onRefresh}><Activity size={14} aria-hidden="true" />刷新 Runs</button>}
    </div>
    <div className="skills-runs-filter-grid" aria-label="Runs 查询和筛选">
      <label className="skills-filter-field"><span>Run ID / Skill</span><span className="skills-filter-input"><Search size={13} aria-hidden="true" /><input aria-label="按 Run ID 或 Skill 搜索" value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} placeholder="搜索 Run ID、Skill Version" /></span></label>
      <label className="skills-filter-field"><span>状态</span><select aria-label="按运行状态筛选" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="all">全部状态</option><option value="running">运行中</option><option value="waiting_approval">等待审批</option><option value="waiting_input">等待输入</option><option value="completed">成功</option><option value="failed">失败</option><option value="cancelled">已取消</option></select></label>
      <label className="skills-filter-field"><span>来源</span><input aria-label="按运行来源筛选" value={filters.source === 'all' ? '' : filters.source} onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value || 'all' }))} placeholder="github、local、Package" /></label>
      <div className="skills-filter-summary" role="status"><span className="skills-status info"><FilterIcon />{filteredRuns.length} / {runs.length} Runs</span></div>
    </div>
    {error && <div className="skills-message error" role="alert"><Info size={14} aria-hidden="true" />{error}</div>}
    {loading && <div className="skills-center-state" role="status"><Activity size={17} aria-hidden="true" />正在加载 Runs…</div>}
    {!loading && filteredRuns.length === 0 && <div className="skills-center-state"><CircleHelp size={17} aria-hidden="true" /><div><strong>没有匹配的 Run</strong><p>调整 Run ID、Skill、状态或来源筛选后重试。</p></div></div>}
    {!loading && filteredRuns.length > 0 && <div className="skills-table-scroll" tabIndex={0} aria-label="Runs 表格，可横向滚动"><table className="skills-data-table"><caption className="skills-sr-only">Skills Runtime 运行记录</caption><thead><tr><th scope="col">Run ID</th><th scope="col">Skill</th><th scope="col">Status</th><th scope="col">Duration</th><th scope="col">Artifacts</th><th scope="col">Source</th><th scope="col">Updated</th></tr></thead><tbody>{filteredRuns.map((run) => <RunRow key={run.id} run={run} artifactCount={artifactCounts[run.id] ?? 0} onOpenRun={onOpenRun} />)}</tbody></table></div>}
  </section>
}

function RunRow({ run, artifactCount, onOpenRun }: { run: SkillRun; artifactCount: number; onOpenRun: (runId: string) => void }) {
  return <tr data-run-id={run.id}><td><button type="button" className="skills-run-id-button" onClick={() => onOpenRun(run.id)} aria-label={`查看 Run ${run.id}`} title="查看 Run 详情">{run.id}</button></td><td><strong>{run.version?.version ? `v${run.version.version}` : run.skillVersionId}</strong><small className="skills-table-subtext">{run.skillVersionId}</small></td><td><RunStatusBadge status={run.status} /></td><td className="skills-center-mono">{formatRunDuration(run)}</td><td>{artifactCount}</td><td><span className="skills-table-source">{run.source || run.version?.source || 'Package Runtime'}</span></td><td><time dateTime={new Date(run.updatedAt).toISOString()}>{formatDateShort(run.updatedAt)}</time></td></tr>
}

function FilterIcon() { return <Search size={12} aria-hidden="true" /> }
function formatDateShort(value: number | null | undefined) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(value) : '—' }
