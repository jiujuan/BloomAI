import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Filter, Github, Plus, Puzzle, Search, SlidersHorizontal } from 'lucide-react'
import { useSkillsStore } from './skills.store'
import type { Skill } from './skills.store'
import { useSkillRuntimeStore } from './skill-runtime.store'
import type { InspectedPackage, PackageManifest, SkillInstallation, SkillPackage, SkillRun, SkillRuntimeFilterStatus, SkillRuntimeSourceFilter, SkillVersion } from './skill-runtime.types'
import { PackageDetailDrawer } from './PackageDetailDrawer'
import { PackageInstallDialog } from './PackageInstallDialog'
import { RunDetailDrawer, RunSkillDialog } from './RunDetailDrawer'
import { SkillArtifactPanel } from './SkillArtifactPanel'
import { SkillCapabilityPanel } from './SkillCapabilityPanel'
import { SkillOverviewPanel } from './SkillOverviewPanel'
import { SkillVersionPanel } from './SkillVersionPanel'
import { SkillsSidebar } from './SkillsSidebar'
import { SkillCreatorWorkbench } from './SkillCreatorWorkbench'
import { cn } from '@renderer/utils'

export type SkillsCenterTab = 'installed' | 'available' | 'runs' | 'drafts' | 'creator'
export type SkillsCenterFilters = { query: string; source: SkillRuntimeSourceFilter; runtime: SkillRuntimeSourceFilter | 'all'; status: SkillRuntimeFilterStatus }
export type SkillListRow = {
  id: string
  kind: 'legacy' | 'package'
  name: string
  description: string
  sourceLabel: string
  runtime: string
  version: string
  enabled: boolean
  statusLabel: string
  statusTone: 'success' | 'warning' | 'danger' | 'info' | 'muted'
  riskLabel: string
  riskTone: 'success' | 'warning' | 'danger' | 'info' | 'muted'
  capabilities: string[]
  lastRunAt: number | null
  run?: SkillRun
}

type SkillsCenterRouteState = { tab?: SkillsCenterTab; selectedPackageId?: string; selectedRunId?: string; draftId?: string }

export function buildSkillRows(packages: SkillPackage[], legacySkills: Skill[], installations: SkillInstallation[], runs: SkillRun[]): SkillListRow[] {
  const installationByPackage = new Map(installations.map((installation) => [installation.packageId, installation]))
  const packageRows = packages.map((item) => {
    const installation = installationByPackage.get(item.id)
    const currentRun = runs.filter((run) => run.skillVersionId === installation?.currentVersionId).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const enabled = Boolean(installation && (installation.enabled === true || installation.enabled === 1) && installation.status === 'active')
    const retired = installation?.status === 'uninstalled' || installation?.status === 'deleted' || Boolean(item.deletedAt)
    return {
      id: item.id, kind: 'package' as const, name: item.name, description: item.description, sourceLabel: `Package · ${item.sourceType || 'unknown'}`,
      runtime: 'Package Runtime', version: installation?.currentVersionId ? '已安装版本' : '未安装', enabled, statusLabel: retired ? '已归档' : installation ? (enabled ? '已启用' : '已禁用') : '未安装',
      statusTone: retired ? 'warning' as const : installation ? (enabled ? 'success' as const : 'muted' as const) : 'info' as const,
      riskLabel: retired ? '历史记录保留' : '来源已固定', riskTone: retired ? 'warning' as const : 'success' as const,
      capabilities: [], lastRunAt: currentRun?.updatedAt ?? null, run: currentRun,
    }
  })
  const legacyRows = legacySkills.map((skill) => ({
    id: skill.id, kind: 'legacy' as const, name: skill.name, description: skill.description, sourceLabel: `Legacy · ${skill.source || 'local'}`,
    runtime: 'Legacy Runtime', version: skill.version || '—', enabled: skill.is_installed === 1, statusLabel: skill.is_installed === 1 ? '已启用' : '未安装', statusTone: skill.is_installed === 1 ? 'success' as const : 'muted' as const,
    riskLabel: 'Legacy 边界', riskTone: 'warning' as const, capabilities: [], lastRunAt: null,
  }))
  return [...packageRows, ...legacyRows]
}

export function filterSkillRows(rows: SkillListRow[], filters: SkillsCenterFilters) {
  const query = filters.query.trim().toLowerCase()
  return rows.filter((row) => {
    const matchesQuery = !query || [row.name, row.description, row.sourceLabel, row.runtime, row.version, row.statusLabel].some((value) => value.toLowerCase().includes(query))
    const matchesSource = filters.source === 'all' || row.kind === filters.source
    const matchesRuntime = filters.runtime === 'all' || row.kind === filters.runtime
    const matchesStatus = filters.status === 'all' || (filters.status === 'enabled' ? row.enabled : filters.status === 'disabled' ? !row.enabled : row.riskTone === 'warning' || row.riskTone === 'danger')
    return matchesQuery && matchesSource && matchesRuntime && matchesStatus
  })
}

export function encodeSkillsCenterState(state: SkillsCenterRouteState) {
  const parts = [`tab=${state.tab || 'installed'}`]
  if (state.selectedPackageId) parts.push(`package=${encodeURIComponent(state.selectedPackageId)}`)
  if (state.selectedRunId) parts.push(`run=${encodeURIComponent(state.selectedRunId)}`)
  if (state.draftId) parts.push(`draft=${encodeURIComponent(state.draftId)}`)
  return `#skills/${parts.join('&')}`
}

export function decodeSkillsCenterState(hash: string): SkillsCenterRouteState {
  if (!hash.startsWith('#skills/')) return {}
  const values = new URLSearchParams(hash.slice('#skills/'.length))
  const rawTab = values.get('tab')
  const tab: SkillsCenterTab | undefined = rawTab === 'installed' || rawTab === 'available' || rawTab === 'runs' || rawTab === 'drafts' || rawTab === 'creator' ? rawTab : undefined
  return { tab, selectedPackageId: values.get('package') || undefined, selectedRunId: values.get('run') || undefined, draftId: values.get('draft') || undefined }
}

export function SkillsCenterWorkbench() {
  const legacy = useSkillsStore()
  const runtime = useSkillRuntimeStore()
  const [route, setRoute] = useState<SkillsCenterRouteState>(() => typeof window === 'undefined' ? {} : decodeSkillsCenterState(window.location.hash))
  const [filters, setFilters] = useState<SkillsCenterFilters>({ query: '', source: 'all', runtime: 'all', status: 'all' })
  const [showInstaller, setShowInstaller] = useState(false)
  const [runVersion, setRunVersion] = useState<SkillVersion | null>(null)

  const tab = route.tab || 'installed'
  useEffect(() => {
    void Promise.allSettled([legacy.loadInstalled(), legacy.loadMarket(), runtime.loadPackages(), runtime.loadRuns()])
  }, [])
  useEffect(() => {
    if (typeof window !== 'undefined') window.history.replaceState(null, '', encodeSkillsCenterState(route))
  }, [route])

  const allRows = useMemo(() => buildSkillRows(runtime.packages, legacy.installed, runtime.installations, runtime.runs), [runtime.packages, legacy.installed, runtime.installations, runtime.runs])
  const packageRows = useMemo(() => buildSkillRows(runtime.packages, [], runtime.installations, runtime.runs), [runtime.packages, runtime.installations, runtime.runs])
  const legacyRows = useMemo(() => buildSkillRows([], tab === 'available' ? legacy.market : legacy.installed, [], []), [legacy.installed, legacy.market, tab])
  const rows = useMemo(() => filterSkillRows(tab === 'available' ? [...packageRows, ...legacyRows] : tab === 'runs' ? allRows.filter((row) => row.run) : allRows, filters), [allRows, packageRows, legacyRows, tab, filters])
  const counts = { installed: allRows.length, available: legacy.market.length, runs: runtime.runs.length, drafts: Object.keys(runtime.drafts).length, creator: 0 }

  const selectTab = (next: SkillsCenterTab) => setRoute({ tab: next, selectedPackageId: next === 'runs' ? route.selectedPackageId : undefined, selectedRunId: next === 'runs' ? route.selectedRunId : undefined, draftId: next === 'creator' ? route.draftId : undefined })
  const openPackage = async (packageId: string) => {
    setRoute((current) => ({ ...current, tab: 'installed', selectedPackageId: packageId }))
    try { await runtime.loadPackage(packageId) } catch { /* store exposes the actionable error */ }
  }
  const openRun = (runId: string) => setRoute((current) => ({ ...current, tab: 'runs', selectedRunId: runId }))
  const startRun = (version: SkillVersion) => setRunVersion(version)
  const openCreator = () => setRoute((current) => ({ ...current, tab: 'creator', selectedPackageId: undefined, selectedRunId: undefined }))
  const createDraft = async () => {
    try {
      const draft = await runtime.createDraft({ content: { name: 'New Skill', slug: 'new-skill', description: '', skillMd: '# New Skill\n', references: {}, assets: [], capabilities: [], visibility: 'private' } })
      setRoute({ tab: 'creator', draftId: draft.id })
      setFilters((current) => ({ ...current, query: '' }))
    } catch { /* store exposes the actionable error */ }
  }

  const openCreatorFromInspection = async (item: InspectedPackage) => {
    const manifest = item.manifest
    try {
      const draft = await runtime.createDraft({ content: {
        name: manifest.name,
        slug: manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'imported-skill',
        version: '0.1.0',
        description: manifest.description || '',
        skillMd: `# ${manifest.name}\n\n${manifest.description || ''}\n`,
        references: Object.fromEntries(manifest.references.map((reference) => [reference, ''])),
        assets: (item.sourceSnapshot.files || []).filter((file) => !/\.(?:exe|dll|com|bat|cmd|sh|ps1|msi|app|dmg|pkg)$/i.test(file.path)).map((file) => ({ path: file.path, sizeBytes: file.sizeBytes })),
        capabilities: manifest.requestedCapabilities,
        visibility: 'private',
      } })
      setShowInstaller(false)
      setRoute({ tab: 'creator', draftId: draft.id })
    } catch { /* store exposes the actionable error */ }
  }

  const selectedRun = runtime.selectedRun?.id === route.selectedRunId ? runtime.selectedRun : route.selectedRunId ? runtime.runs.find((run) => run.id === route.selectedRunId) : null
  const selectedPackage = runtime.selectedPackage?.package.id === route.selectedPackageId ? runtime.selectedPackage : null
  const selectedVersion = (runtime.selectedVersion && selectedPackage?.versions.some((version) => version.id === runtime.selectedVersion?.id) ? runtime.selectedVersion : undefined) || selectedPackage?.versions.find((version) => version.id === (selectedPackage.installations[0]?.currentVersionId || selectedPackage.installations[0]?.current_version_id)) || selectedPackage?.versions[0]
  const manifest = selectedVersion?.manifest as PackageManifest | undefined
  const selectedArtifacts = selectedRun ? runtime.artifactsByRun[selectedRun.id] || [] : []

  const approveGrant = async (grant: NonNullable<typeof selectedPackage>['capabilityGrants'][number]) => {
    if (typeof window !== 'undefined' && !window.confirm(`批准 ${grant.capability} 将允许当前 Package 使用以下 scope：${JSON.stringify(grant.scope)}。是否继续？`)) return
    await runtime.approve(grant.id, { actor: 'skills-center' })
  }
  const rejectGrant = async (grant: NonNullable<typeof selectedPackage>['capabilityGrants'][number]) => {
    if (typeof window !== 'undefined' && !window.confirm(`拒绝 ${grant.capability} 后，相关 Run 可能保持 waiting_approval。是否继续？`)) return
    await runtime.reject(grant.id, { actor: 'skills-center', reason: 'Rejected from Skills Center' })
  }
  const exportArtifact = async (artifact: NonNullable<typeof selectedArtifacts>[number]) => {
    const destinationDir = typeof window !== 'undefined' ? window.prompt('输入导出目录（服务端会校验权限）：', '')?.trim() : ''
    if (!destinationDir || !selectedRun || (typeof window !== 'undefined' && !window.confirm(`确认将 ${artifact.path} 导出到 ${destinationDir}？此操作会记录审计事件。`))) return
    await runtime.exportArtifact(artifact.id, { runId: selectedRun.id, destinationDir, confirmed: true, auditReason: 'Exported from Skills Center' })
  }

  return <div className="skills-center" data-testid="skills-center-workbench">
    <header className="skills-center-topbar"><div className="skills-page-title"><Puzzle size={17} /><div><span className="skills-title">Skills Center</span><span className="skills-subtitle">安装、运行、权限与 Artifact 的统一控制台</span></div></div><div className="skills-center-search skills-search"><Search size={13} aria-hidden="true" /><input aria-label="搜索 Skills" value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} placeholder="搜索名称、来源、运行状态…" /></div><button type="button" className="skills-tbtn" onClick={openCreator}><Plus size={13} aria-hidden="true" />打开 Creator</button><button type="button" className="skills-tbtn primary" onClick={() => setShowInstaller(true)}><Github size={13} aria-hidden="true" />导入 Package</button></header>
    <div className="skills-center-layout"><SkillsSidebar tab={tab} counts={counts} onChange={selectTab} /><main className="skills-center-main"><div className="skills-center-filterbar" aria-label="Skills 筛选"><SlidersHorizontal size={14} aria-hidden="true" /><label>来源<select value={filters.source} onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value as SkillsCenterFilters['source'] }))}><option value="all">全部</option><option value="package">Package</option><option value="legacy">Legacy</option></select></label><label>Runtime<select value={filters.runtime} onChange={(event) => setFilters((current) => ({ ...current, runtime: event.target.value as SkillsCenterFilters['runtime'] }))}><option value="all">全部</option><option value="package">Package</option><option value="legacy">Legacy</option></select></label><label>状态<select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as SkillsCenterFilters['status'] }))}><option value="all">全部</option><option value="enabled">已启用</option><option value="disabled">已禁用</option><option value="attention">需关注</option></select></label><Filter size={14} aria-hidden="true" /><span>{rows.length} 条结果</span></div>{runtime.error && <div className="skills-page-message"><AlertTriangle size={14} aria-hidden="true" />{runtime.error}<button type="button" onClick={runtime.clearError} aria-label="关闭提示">×</button></div>}
      {tab === 'drafts' && <DraftsPanel drafts={runtime.drafts} onCreate={createDraft} onOpenDraft={(id) => setRoute({ tab: 'creator', draftId: id })} onOpenCreator={openCreator} />}
      {tab === 'creator' && <SkillCreatorWorkbench draftId={route.draftId || null} onCreated={createDraft} />}
      {(tab === 'installed' || tab === 'available' || tab === 'runs') && <SkillOverviewPanel rows={rows} tab={tab} loading={runtime.loading || legacy.loading} onOpenPackage={openPackage} onOpenRun={openRun} onInstall={() => setShowInstaller(true)} />}
      {selectedPackage && <div className="skills-center-detail-grid"><SkillVersionPanel versions={selectedPackage.versions} currentVersionId={selectedVersion?.id} onSelect={runtime.selectVersion} /><SkillCapabilityPanel manifest={manifest} grants={selectedPackage.capabilityGrants} onApprove={approveGrant} onReject={rejectGrant} /></div>}
      {selectedRun && <SkillArtifactPanel runId={selectedRun.id} artifacts={selectedArtifacts} onExport={exportArtifact} />}
    </main></div>
    {showInstaller && <PackageInstallDialog onClose={() => setShowInstaller(false)} onOpenCreator={openCreatorFromInspection} />}
    {selectedPackage && <PackageDetailDrawer detail={selectedPackage} runs={runtime.runs} onClose={() => setRoute((current) => ({ ...current, selectedPackageId: undefined }))} onRun={startRun} onOpenRun={openRun} />}
    {route.selectedRunId && <RunDetailDrawer runId={route.selectedRunId} onClose={() => setRoute((current) => ({ ...current, selectedRunId: undefined }))} />}
    {runVersion && <RunSkillDialog version={runVersion} onClose={() => setRunVersion(null)} onStarted={openRun} />}
  </div>
}

function DraftsPanel({ drafts, onCreate, onOpenDraft, onOpenCreator }: { drafts: Record<string, import('./skill-runtime.types').DraftDto>; onCreate: () => void; onOpenDraft: (id: string) => void; onOpenCreator: () => void }) {
  const entries = Object.values(drafts).filter((draft) => draft.status !== 'discarded')
  return <section className="skills-center-panel" aria-labelledby="skills-drafts-title"><div className="skills-center-panel-head"><div><div className="skills-eyebrow">Creator</div><h2 id="skills-drafts-title">Drafts</h2><p>草稿、revision 和发布动作由 server 管理；当前工作台只提供安全入口。</p></div><button type="button" className="skills-button primary" onClick={onCreate}>新建 Draft</button></div>{entries.length === 0 ? <div className="skills-center-state"><Plus size={18} aria-hidden="true" /><div><strong>还没有 Draft</strong><p>打开 Creator 开始编辑 metadata、SKILL.md 和 capability 请求。</p><button type="button" className="skills-text-button" onClick={onOpenCreator}>打开 Creator</button></div></div> : <div className="skills-runs-list">{entries.map((draft) => <button type="button" className="skills-run-row" key={draft.id} onClick={() => onOpenDraft(draft.id)}><div><strong>{draft.content.name || draft.id}</strong><p>{draft.content.slug} · revision {draft.revision}</p></div><span className="skills-status info">{draft.status || 'draft'}</span></button>)}</div>}</section>
}

function CreatorEntryPanel({ enabled, onCreateDraft }: { enabled: boolean; onCreateDraft: () => void }) {
  return <section className="skills-center-panel" aria-labelledby="skills-creator-title"><div className="skills-center-panel-head"><div><div className="skills-eyebrow"><Plus size={14} /> Skills Creator</div><h2 id="skills-creator-title">从元数据到可验证 Draft</h2><p>Creator 将在此工作台内承载编辑、验证、预览和发布；发布入口受 feature flag 控制。</p></div></div>{!enabled && <div className="skills-message warning">Creator 功能已关闭。现有 Legacy、Package 查询和审计能力不受影响。</div>}<div className="skills-center-creator-steps"><span>1 Metadata</span><span>2 SKILL.md</span><span>3 Capabilities</span><span>4 Validate / Preview</span><span>5 Publish</span></div><button type="button" className="skills-button primary" disabled={!enabled} onClick={onCreateDraft}>开始本地 Draft</button></section>
}

export function skillSourceLabel(kind: SkillListRow['kind'], source: string) { return `${kind === 'package' ? 'Package' : 'Legacy'} · ${source}` }
