import React, { useMemo } from 'react'
import {
  Activity,
  Box,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Edit3,
  Eye,
  Filter,
  History,
  Info,
  PackageCheck,
  PauseCircle,
  PlayCircle,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { cn } from '@renderer/utils'
import type { SkillListRow } from './SkillsCenterWorkbench'
import type { SkillRun, SkillRunStatus } from './skill-runtime.types'
import { formatDate } from './skill-runtime.types'

export type CatalogMetrics = {
  totalSkills: number
  enabledSkills: number
  weeklyRuns: number
  pendingItems: number
}

export type CatalogTabKey = 'all' | 'enabled' | 'installed' | 'pending' | 'running' | 'failed' | 'draft' | 'quarantine'
export type CatalogSortKey = 'recent' | 'name' | 'status'

export const CATALOG_TAB_DEFINITIONS: Array<{ key: CatalogTabKey; label: string }> = [
  { key: 'all', label: '全部 Skills' },
  { key: 'enabled', label: '已启用' },
  { key: 'installed', label: '已安装' },
  { key: 'pending', label: '待审批' },
  { key: 'running', label: '运行中' },
  { key: 'failed', label: '失败' },
  { key: 'draft', label: '草稿' },
  { key: 'quarantine', label: '隔离区' },
]

function catalogRowText(row: SkillListRow) {
  return `${row.statusLabel} ${row.riskLabel} ${row.version}`.toLowerCase()
}

export function matchesCatalogTab(row: SkillListRow, tab: CatalogTabKey) {
  const text = catalogRowText(row)
  const runStatus = row.run?.status
  if (tab === 'all') return true
  if (tab === 'enabled') return row.enabled || text.includes('启用')
  if (tab === 'installed') return Boolean(row.installationId) || (row.version !== '未安装' && !text.includes('未安装'))
  if (tab === 'pending') return runStatus === 'waiting_approval' || runStatus === 'waiting_input' || text.includes('待审批') || text.includes('待处理')
  if (tab === 'running') return runStatus === 'created' || runStatus === 'validating' || runStatus === 'running' || text.includes('运行中')
  if (tab === 'failed') return runStatus === 'failed' || runStatus === 'cancelled' || runStatus === 'interrupted' || text.includes('失败')
  if (tab === 'draft') return text.includes('draft') || text.includes('草稿')
  return text.includes('quarantine') || text.includes('隔离')
}

export function getCatalogTabCounts(rows: SkillListRow[]): Record<CatalogTabKey, number> {
  return CATALOG_TAB_DEFINITIONS.reduce((counts, tab) => {
    counts[tab.key] = tab.key === 'all' ? rows.length : rows.filter((row) => matchesCatalogTab(row, tab.key)).length
    return counts
  }, {} as Record<CatalogTabKey, number>)
}

export function filterCatalogRowsByTab(rows: SkillListRow[], tab: CatalogTabKey) {
  return tab === 'all' ? rows : rows.filter((row) => matchesCatalogTab(row, tab))
}

export function sortCatalogRows(rows: SkillListRow[], sort: CatalogSortKey) {
  return [...rows].sort((left, right) => {
    if (sort === 'name') return left.name.localeCompare(right.name)
    if (sort === 'status') return left.statusLabel.localeCompare(right.statusLabel)
    return (right.lastRunAt ?? -Infinity) - (left.lastRunAt ?? -Infinity)
  })
}

export type SkillStatusVisual = {
  label: string
  tone: SkillListRow['statusTone']
  icon: 'check' | 'pause' | 'clock' | 'shield' | 'error' | 'info'
}

const STATUS_LEGEND: Array<SkillStatusVisual & { description: string }> = [
  { label: '已启用', tone: 'success', icon: 'check', description: 'Installation 可被 Runtime 使用' },
  { label: '已禁用', tone: 'muted', icon: 'pause', description: 'Installation 保留但暂不执行' },
  { label: '待处理', tone: 'warning', icon: 'clock', description: '需要审批、确认或后续动作' },
  { label: '已隔离', tone: 'danger', icon: 'shield', description: '安全策略阻止执行' },
]

export type CatalogActionDescriptor = { key: 'detail' | 'toggle' | 'version' | 'uninstall'; label: string; danger?: boolean }

export function getCatalogActionDescriptors(row: { enabled: boolean; [key: string]: unknown }): CatalogActionDescriptor[] {
  return [
    { key: 'detail', label: '查看详情' },
    { key: 'toggle', label: row.enabled ? '禁用 Installation' : '启用 Installation' },
    { key: 'version', label: '创建新版本' },
    { key: 'uninstall', label: '卸载 Installation', danger: true },
  ]
}

export function shouldConfirmCatalogUninstall(row: Pick<SkillListRow, 'name'>, confirm: (message: string) => boolean) {
  return confirm(`确认卸载 ${row.name} 的 Installation？该操作会停止运行，但保留审计记录。`)
}

export function getSkillStatusVisual(row: Pick<SkillListRow, 'statusLabel' | 'statusTone'>): SkillStatusVisual {
  const normalized = row.statusLabel.toLowerCase()
  if (row.statusTone === 'success' || normalized.includes('启用')) return { label: row.statusLabel, tone: row.statusTone, icon: 'check' }
  if (row.statusTone === 'muted' || normalized.includes('禁用') || normalized.includes('未安装')) return { label: row.statusLabel, tone: row.statusTone, icon: 'pause' }
  if (row.statusTone === 'danger' || normalized.includes('隔离') || normalized.includes('失败')) return { label: row.statusLabel, tone: row.statusTone, icon: 'shield' }
  if (row.statusTone === 'warning' || normalized.includes('归档') || normalized.includes('等待') || normalized.includes('待')) return { label: row.statusLabel, tone: row.statusTone, icon: 'clock' }
  return { label: row.statusLabel, tone: row.statusTone, icon: 'info' }
}

export function buildCatalogMetrics(rows: SkillListRow[], runs: SkillRun[], now = Date.now()): CatalogMetrics {
  const weekStart = now - 7 * 24 * 60 * 60 * 1000
  return {
    totalSkills: rows.length,
    enabledSkills: rows.filter((row) => row.enabled).length,
    weeklyRuns: runs.filter((run) => run.updatedAt >= weekStart && run.updatedAt <= now).length,
    pendingItems: runs.filter((run) => run.status === 'waiting_approval' || run.requiredAction?.type === 'approve').length,
  }
}

export function paginateCatalogRows(rows: SkillListRow[], page: number, pageSize: number): SkillListRow[] {
  const safePage = Math.max(0, Math.floor(page))
  const safePageSize = Math.max(1, Math.floor(pageSize))
  return rows.slice(safePage * safePageSize, (safePage + 1) * safePageSize)
}

export function shouldHideSkillsAdminAccessError(error?: string | null) {
  return error === 'Skills operation requires administrator access'
}

export type SkillsCenterCatalogProps = {
  rows: SkillListRow[]
  allRows?: SkillListRow[]
  runs: SkillRun[]
  loading: boolean
  error?: string | null
  page: number
  pageSize: number
  totalRows?: number
  onPageChange: (page: number) => void
  onOpenPackage: (packageId: string) => void
  onOpenRun: (runId: string) => void
  onToggleInstallation?: (row: SkillListRow) => void | Promise<void>
  onCreateVersion?: (packageId: string) => void | Promise<void>
  onUninstallInstallation?: (row: SkillListRow) => void | Promise<void>
  catalogSearch?: string
  catalogSort?: CatalogSortKey
  catalogTab?: CatalogTabKey
  catalogFiltersOpen?: boolean
  onCatalogSearchChange?: (query: string) => void
  onCatalogSortChange?: (sort: CatalogSortKey) => void
  onCatalogTabChange?: (tab: CatalogTabKey) => void
  onCatalogFilterClick?: () => void
}

export function SkillsCenterCatalog({
  rows,
  allRows,
  runs,
  loading,
  error,
  page,
  pageSize,
  totalRows = rows.length,
  onPageChange,
  onOpenPackage,
  onOpenRun,
  onToggleInstallation = () => undefined,
  onCreateVersion = () => undefined,
  onUninstallInstallation = () => undefined,
  catalogSearch = '',
  catalogSort = 'recent',
  catalogTab = 'all',
  catalogFiltersOpen = false,
  onCatalogSearchChange = () => undefined,
  onCatalogSortChange = () => undefined,
  onCatalogTabChange = () => undefined,
  onCatalogFilterClick = () => undefined,
}: SkillsCenterCatalogProps) {
  const catalogSourceRows = allRows ?? rows
  const tabCounts = useMemo(() => getCatalogTabCounts(catalogSourceRows), [catalogSourceRows])
  const metrics = useMemo(() => buildCatalogMetrics(catalogSourceRows, runs), [catalogSourceRows, runs])
  const pendingRuns = useMemo(() => runs.filter((run) => run.status === 'waiting_approval' || run.requiredAction?.type === 'approve').sort((a, b) => b.updatedAt - a.updatedAt), [runs])
  const recentRuns = useMemo(() => [...runs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5), [runs])
  const totalPages = Math.max(1, Math.ceil(totalRows / Math.max(1, pageSize)))
  const currentPage = Math.min(Math.max(0, page), totalPages - 1)
  const visibleError = shouldHideSkillsAdminAccessError(error) ? null : error

  return <div className="skills-catalog" data-testid="skills-center-catalog">
    <section className="skills-catalog-kpis" aria-label="Skills Center 指标">
      <MetricCard label="全部 Skills" value={metrics.totalSkills} icon={<PackageCheck size={16} />} tone="info" />
      <MetricCard label="已启用" value={metrics.enabledSkills} icon={<CheckCircle2 size={16} />} tone="success" />
      <MetricCard label="本周 Runs" value={metrics.weeklyRuns} icon={<Activity size={16} />} tone="brand" />
      <MetricCard label="待处理事项" value={metrics.pendingItems} icon={<Clock3 size={16} />} tone={metrics.pendingItems > 0 ? 'warning' : 'muted'} />
    </section>

    <section className="skills-status-language" aria-labelledby="skills-status-language-title">
      <div className="skills-status-language-heading"><div><div className="skills-eyebrow"><Info size={13} /> Status language</div><h3 id="skills-status-language-title">状态语言</h3></div><span>图标 + 文字 + 颜色</span></div>
      <div className="skills-status-language-list">{STATUS_LEGEND.map((item) => <StatusBadge key={item.label} visual={item} description={item.description} />)}</div>
    </section>

    <section className="skills-center-panel skills-catalog-panel" aria-labelledby="skills-catalog-title">
      <div className="skills-catalog-panel-head">
        <div className="skills-catalog-heading">
          <div className="skills-eyebrow"><Box size={14} /> Package Runtime</div>
          <div className="skills-catalog-title-row"><h2 id="skills-catalog-title">Skill Catalog</h2><span className="skills-catalog-result-count">{totalRows} 个结果</span></div>
          <p>当前列表只展示 Package Skill；详情、运行和 Capability 审批共享同一 Package 上下文。</p>
        </div>
        <div className="skills-catalog-tools">
          <label className="skills-catalog-search"><Search size={16} aria-hidden="true" /><span className="sr-only">搜索 Skill Catalog</span><input aria-label="搜索 Skill Catalog" value={catalogSearch} onChange={(event) => onCatalogSearchChange(event.target.value)} placeholder="搜索名称、Slug 或描述" /></label>
          <label className="skills-catalog-sort"><span className="sr-only">Skill Catalog 排序</span><select aria-label="Skill Catalog 排序" value={catalogSort} onChange={(event) => onCatalogSortChange(event.target.value as CatalogSortKey)}><option value="recent">最近更新</option><option value="name">名称</option><option value="status">状态</option></select></label>
          <button type="button" className={cn('skills-catalog-filter-button', catalogFiltersOpen && 'active')} aria-label="打开 Skill Catalog 筛选" aria-pressed={catalogFiltersOpen} onClick={onCatalogFilterClick}><Filter size={15} aria-hidden="true" />筛选</button>
        </div>
      </div>
      <div className="skills-catalog-tabs" role="tablist" aria-label="Skill Catalog 状态">{CATALOG_TAB_DEFINITIONS.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={catalogTab === tab.key} className={cn('skills-catalog-tab', catalogTab === tab.key && 'active')} onClick={() => onCatalogTabChange(tab.key)}><span>{tab.label}</span><strong>{tabCounts[tab.key]}</strong></button>)}</div>
      <div id="skills-catalog-content">
        {visibleError && <div className="skills-page-message" role="alert"><CircleAlert size={14} aria-hidden="true" /><span>{visibleError}</span></div>}
        {loading && <div className="skills-center-state" role="status"><Activity size={18} aria-hidden="true" /><div><strong>正在加载 Package Catalog</strong><p>正在读取 Package、Installation 和 Runtime 状态。</p></div></div>}
        {!loading && !visibleError && rows.length === 0 && <div className="skills-center-state skills-catalog-empty"><CircleAlert size={18} aria-hidden="true" /><div><strong>暂无 Package Skill</strong><p>当前筛选没有匹配的 Package；可以调整搜索条件或进入“导入 Skill”。</p></div></div>}
        {!loading && !visibleError && rows.length > 0 && <div className="skills-center-table-wrap"><table className="skills-center-table skills-catalog-table"><caption className="sr-only">Package Skill Catalog</caption><thead><tr><th>Skill</th><th>Version</th><th>Status</th><th>Risk</th><th>Capabilities</th><th>最近运行</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{rows.map((row) => <CatalogRow key={`package:${row.id}`} row={row} onOpenPackage={onOpenPackage} onToggleInstallation={onToggleInstallation} onCreateVersion={onCreateVersion} onUninstallInstallation={onUninstallInstallation} />)}</tbody></table></div>}
        {!loading && !visibleError && totalRows > pageSize && <Pagination page={currentPage} totalPages={totalPages} onPageChange={onPageChange} />}
      </div>
    </section>

    <div className="skills-catalog-secondary-grid">
      <section className="skills-center-panel" aria-labelledby="skills-recent-runs-title"><div className="skills-center-panel-head"><div><div className="skills-eyebrow"><History size={14} /> Observe / Runtime</div><h2 id="skills-recent-runs-title">最近运行</h2><p>Run 状态与 Package Catalog 使用同一套状态语言。</p></div><button type="button" className="skills-text-button" onClick={() => onOpenRun(recentRuns[0]?.id || '')} disabled={recentRuns.length === 0}>查看运行记录 <ChevronRight size={13} aria-hidden="true" /></button></div>{recentRuns.length === 0 ? <EmptyNotice title="暂无最近 Run" body="Package 安装并运行后，最近运行会显示在这里。" /> : <div className="skills-center-run-list">{recentRuns.map((run) => <RunSummary key={run.id} run={run} onOpenRun={onOpenRun} />)}</div>}</section>
      <section className="skills-center-panel" aria-labelledby="skills-pending-title"><div className="skills-center-panel-head"><div><div className="skills-eyebrow"><ShieldAlert size={14} /> Review queue</div><h2 id="skills-pending-title">待处理事项</h2><p>需要人工审批的 Run 会保留原始上下文和审计入口。</p></div><span className="skills-status warning">{pendingRuns.length} Pending</span></div>{pendingRuns.length === 0 ? <EmptyNotice title="没有待处理事项" body="当前没有等待 Capability 审批的 Package Run。" /> : <div className="skills-pending-list">{pendingRuns.map((run) => <button type="button" className="skills-pending-row" key={run.id} onClick={() => onOpenRun(run.id)}><span className="skills-status-icon warning"><Clock3 size={14} aria-hidden="true" /></span><span><strong>Pending Approval</strong><small>{run.id} · {run.requiredAction?.capability || run.waitingReason || 'Capability 请求'}</small></span><ChevronRight size={14} aria-hidden="true" /></button>)}</div>}</section>
    </div>
  </div>
}

function MetricCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: string }) {
  return <div className={`skills-kpi-card ${tone}`}><span className="skills-kpi-icon" aria-hidden="true">{icon}</span><div><span>{label}</span><strong>{value}</strong></div></div>
}

function StatusBadge({ visual, description }: { visual: SkillStatusVisual; description?: string }) {
  return <span className={`skills-status ${visual.tone}`} title={description} aria-label={`${visual.label}：${description || ''}`}><StatusIcon icon={visual.icon} /><span>{visual.label}</span></span>
}

function StatusIcon({ icon }: { icon: SkillStatusVisual['icon'] }) {
  if (icon === 'check') return <CheckCircle2 size={13} aria-hidden="true" />
  if (icon === 'pause') return <PauseCircle size={13} aria-hidden="true" />
  if (icon === 'clock') return <Clock3 size={13} aria-hidden="true" />
  if (icon === 'shield') return <ShieldAlert size={13} aria-hidden="true" />
  if (icon === 'error') return <XCircle size={13} aria-hidden="true" />
  return <Info size={13} aria-hidden="true" />
}

function CatalogRow({ row, onOpenPackage, onToggleInstallation, onCreateVersion, onUninstallInstallation }: { row: SkillListRow; onOpenPackage: (packageId: string) => void; onToggleInstallation: (row: SkillListRow) => void | Promise<void>; onCreateVersion: (packageId: string) => void | Promise<void>; onUninstallInstallation: (row: SkillListRow) => void | Promise<void> }) {
  const visual = getSkillStatusVisual(row)
  const actions = getCatalogActionDescriptors(row)
  const icons = { detail: Eye, toggle: row.enabled ? PauseCircle : PlayCircle, version: Edit3, uninstall: XCircle } as const
  const handlers = { detail: () => onOpenPackage(row.id), toggle: () => onToggleInstallation(row), version: () => onCreateVersion(row.id), uninstall: () => onUninstallInstallation(row) } as const
  return <tr><td><div className="skills-center-skill-cell"><span className="skills-center-kind-icon package" aria-hidden="true"><Box size={15} /></span><div><strong>{row.name}</strong><small>{row.description || '未提供描述'}</small><span className="skills-center-source-label">{row.sourceLabel}</span></div></div></td><td className="skills-center-mono">{row.version}</td><td><StatusBadge visual={visual} /></td><td><span className={`skills-status ${row.riskTone}`}><ShieldAlert size={13} aria-hidden="true" />{row.riskLabel}</span></td><td><div className="skills-capability-list">{row.capabilities.length > 0 ? row.capabilities.map((capability) => <span key={capability}>{capability}</span>) : <small>无额外能力</small>}</div></td><td>{row.lastRunAt ? formatDate(row.lastRunAt) : '—'}</td><td className="skills-center-actions">{actions.map((action) => { const Icon = icons[action.key]; return <button key={action.key} type="button" className={`skills-icon-button skills-catalog-action-button${action.danger ? ' danger' : ''}`} aria-label={action.label} title={action.label} data-tooltip={action.label} disabled={(action.key === 'toggle' || action.key === 'uninstall') && !row.installationId} onClick={() => void handlers[action.key]()}><Icon size={14} aria-hidden="true" /></button> })}</td></tr>
}

function RunSummary({ run, onOpenRun }: { run: SkillRun; onOpenRun: (runId: string) => void }) {
  const visual = getRunStatusVisual(run.status)
  return <button type="button" className="skills-center-run-row" onClick={() => onOpenRun(run.id)}><div><strong className="skills-center-mono">{run.id}</strong><span>{run.skillVersionId} · {run.surface || 'skills'}</span></div><div><span className={`skills-status ${visual.tone}`}><StatusIcon icon={visual.icon} />{visual.label}</span><time>{formatDate(run.updatedAt)}</time><ChevronRight size={14} aria-hidden="true" /></div></button>
}

function getRunStatusVisual(status: SkillRunStatus): SkillStatusVisual {
  if (status === 'completed') return { label: '成功', tone: 'success', icon: 'check' }
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return { label: status === 'cancelled' ? '已取消' : '失败', tone: 'danger', icon: 'error' }
  if (status === 'waiting_approval' || status === 'waiting_input') return { label: status === 'waiting_approval' ? '等待审批' : '等待输入', tone: 'warning', icon: 'clock' }
  if (status === 'completed_with_errors') return { label: '部分成功', tone: 'warning', icon: 'info' }
  return { label: '运行中', tone: 'info', icon: 'info' }
}

function EmptyNotice({ title, body }: { title: string; body: string }) {
  return <div className="skills-center-state"><CircleAlert size={18} aria-hidden="true" /><div><strong>{title}</strong><p>{body}</p></div></div>
}

function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (page: number) => void }) {
  return <nav className="skills-pagination" aria-label="Skills Catalog 分页"><button type="button" className="skills-icon-button" aria-label="上一页" title="上一页" disabled={page <= 0} onClick={() => onPageChange(page - 1)}><ChevronLeft size={14} aria-hidden="true" /></button><span>第 {page + 1} / {totalPages} 页</span><button type="button" className="skills-icon-button" aria-label="下一页" title="下一页" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}><ChevronRight size={14} aria-hidden="true" /></button></nav>
}

type SkillOverviewPanelProps = {
  rows: SkillListRow[]
  allRows?: SkillListRow[]
  tab: 'center' | 'import' | 'runs'
  loading: boolean
  error?: string | null
  runs?: SkillRun[]
  page?: number
  pageSize?: number
  totalRows?: number
  onPageChange?: (page: number) => void
  onOpenPackage: (packageId: string) => void
  onOpenRun: (runId: string) => void
  onInstall: () => void
  onToggleInstallation?: (row: SkillListRow) => void | Promise<void>
  onCreateVersion?: (packageId: string) => void | Promise<void>
  onUninstallInstallation?: (row: SkillListRow) => void | Promise<void>
  catalogSearch?: string
  catalogSort?: CatalogSortKey
  catalogTab?: CatalogTabKey
  catalogFiltersOpen?: boolean
  onCatalogSearchChange?: (query: string) => void
  onCatalogSortChange?: (sort: CatalogSortKey) => void
  onCatalogTabChange?: (tab: CatalogTabKey) => void
  onCatalogFilterClick?: () => void
}

export function SkillOverviewPanel({ rows, allRows, tab, loading, error, runs = [], page = 0, pageSize = 10, totalRows, onPageChange = () => undefined, onOpenPackage, onOpenRun, onToggleInstallation = () => undefined, onCreateVersion = () => undefined, onUninstallInstallation = () => undefined, onInstall, catalogSearch, catalogSort, catalogTab, catalogFiltersOpen, onCatalogSearchChange, onCatalogSortChange, onCatalogTabChange, onCatalogFilterClick }: SkillOverviewPanelProps) {
  if (tab === 'runs') return <RunOverview rows={rows} loading={loading} onOpenRun={onOpenRun} />
  return <SkillsCenterCatalog rows={rows.filter((row) => row.kind === 'package')} allRows={allRows?.filter((row) => row.kind === 'package')} runs={runs} loading={loading} error={error} page={page} pageSize={pageSize} totalRows={totalRows ?? rows.filter((row) => row.kind === 'package').length} onPageChange={onPageChange} onOpenPackage={onOpenPackage} onOpenRun={onOpenRun} onToggleInstallation={onToggleInstallation} onCreateVersion={onCreateVersion} onUninstallInstallation={onUninstallInstallation} catalogSearch={catalogSearch} catalogSort={catalogSort} catalogTab={catalogTab} catalogFiltersOpen={catalogFiltersOpen} onCatalogSearchChange={onCatalogSearchChange} onCatalogSortChange={onCatalogSortChange} onCatalogTabChange={onCatalogTabChange} onCatalogFilterClick={onCatalogFilterClick} />
}

function RunOverview({ rows, loading, onOpenRun }: { rows: SkillListRow[]; loading: boolean; onOpenRun: (runId: string) => void }) {
  const runs = rows.flatMap((row) => row.run ? [row.run] : [])
  return <section className="skills-center-panel" aria-labelledby="skills-runs-title"><div className="skills-center-panel-head"><div><div className="skills-eyebrow"><History size={14} /> Observe / Runtime</div><h2 id="skills-runs-title">Runs</h2><p>查看状态、审批、事件和 Artifact；停止新 Run 不会删除既有审计记录。</p></div></div>{loading && <div className="skills-center-state" role="status">正在加载 Runs…</div>}{!loading && runs.length === 0 && <div className="skills-center-state"><CircleAlert size={18} aria-hidden="true" /><div><strong>暂无 Package Run</strong><p>从已安装 Package 的详情页发起运行后，这里会保留可查询的审计记录。</p></div></div>}{!loading && runs.length > 0 && <div className="skills-center-run-list">{runs.map((run) => <RunSummary key={run.id} run={run} onOpenRun={onOpenRun} />)}</div>}</section>
}
