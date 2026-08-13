import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Filter, Plus, Puzzle, Search, SlidersHorizontal, Upload } from 'lucide-react'
import { useSkillRuntimeStore } from './skill-runtime.store'
import { getPublishedPackageId } from './skill-runtime.types'
import type { InspectedPackage, PackageManifest, SkillArtifact, SkillInstallation, SkillPackage, SkillRun, SkillRuntimeCapabilities, SkillRuntimeFilterStatus, SkillRuntimeSourceFilter, SkillVersion } from './skill-runtime.types'
import { PackageDetailDrawer } from './PackageDetailDrawer'
import { PackageImportWorkbench } from './PackageInstallDialog'
import { RunSkillDialog } from './RunSkillDialog'
import { filterCatalogRowsByTab, paginateCatalogRows, shouldConfirmCatalogUninstall, shouldHideSkillsAdminAccessError, SkillOverviewPanel, sortCatalogRows } from './SkillOverviewPanel'
import type { CatalogSortKey, CatalogTabKey } from './SkillOverviewPanel'
import { SkillVersionPanel } from './SkillVersionPanel'
import { getSkillsBreadcrumb, normalizeSkillsView, SkillsSidebar } from './SkillsSidebar'
import type { SkillsCenterTab as SkillsRouteTab, SkillsRuntimeView } from './SkillsSidebar'
import { SkillCreatorWorkbench } from './SkillCreatorWorkbench'
import { RunsWorkbench } from './RunsWorkbench'
import { ArtifactsWorkbench } from './ArtifactsWorkbench'
import { SkillRuntimeSettingsPanel } from './SkillRuntimeSettingsPanel'
import { cn } from '@renderer/utils'

export type SkillsCenterTab = SkillsRouteTab
export type SkillsCenterFilters = { query: string; source: SkillRuntimeSourceFilter; runtime: SkillRuntimeSourceFilter | 'all'; status: SkillRuntimeFilterStatus }

const SKILLS_CATALOG_PAGE_SIZE = 10
export type SkillListRow = {
  id: string
  kind: 'package'
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
  installationId?: string
  installationRevision?: number
}

type SkillsCenterRouteState = { tab?: SkillsCenterTab; selectedPackageId?: string; draftId?: string }

export function getRunSkillLabel(run: SkillRun) {
  return run.version ? `${run.version.source || 'Package Runtime'} · v${run.version.version}` : 'Package Runtime'
}

export function buildArtifactExplorerRecords(runs: SkillRun[], artifactsByRun: Record<string, import('./skill-runtime.types').SkillArtifact[]>) {
  return runs.flatMap((run) => (artifactsByRun[run.id] ?? []).map((artifact) => ({ artifact, skillLabel: getRunSkillLabel(run) })))
}
export function buildSkillRows(packages: SkillPackage[], installations: SkillInstallation[], runs: SkillRun[]): SkillListRow[] {
  const installationByPackage = new Map(installations.map((installation) => [installation.packageId, installation]))
  return packages.map((item) => {
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
      installationId: installation?.id, installationRevision: installation?.revision ?? 0,
    }
  })
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
  const parts = [`tab=${state.tab || 'center'}`]
  if (state.selectedPackageId) parts.push(`package=${encodeURIComponent(state.selectedPackageId)}`)
  if (state.draftId) parts.push(`draft=${encodeURIComponent(state.draftId)}`)
  return `#skills/${parts.join('&')}`
}

type SkillsCenterTabCompat = SkillsCenterTab | 'permissions' | 'run-detail'

function isSkillsCenterTab(value: string | null): value is SkillsCenterTab {
  return value === 'runs' || value === 'creator' || value === 'center' || value === 'import' || value === 'detail' || value === 'artifacts' || value === 'settings'
}

export function decodeSkillsCenterState(hash: string): SkillsCenterRouteState {
  if (!hash.startsWith('#skills/')) return {}
  const values = new URLSearchParams(hash.slice('#skills/'.length))
  const rawTab = values.get('tab') as SkillsCenterTabCompat | null
  const tab: SkillsCenterTab | undefined = rawTab === 'permissions' || rawTab === 'run-detail' ? (rawTab === 'run-detail' ? 'runs' : 'detail') : isSkillsCenterTab(rawTab) ? rawTab : undefined
  return { tab, selectedPackageId: values.get('package') || undefined, draftId: values.get('draft') || undefined }
}

export function hasRuntimeManagementCapability(capabilities: Pick<SkillRuntimeCapabilities, 'canManage'> | null) {
  return capabilities?.canManage === true
}

export function SkillsCenterWorkbench() {
  const runtime = useSkillRuntimeStore()
  const [route, setRoute] = useState<SkillsCenterRouteState>(() => typeof window === 'undefined' ? {} : decodeSkillsCenterState(window.location.hash))
  const [filters, setFilters] = useState<SkillsCenterFilters>({ query: '', source: 'all', runtime: 'all', status: 'all' })
  const [runVersion, setRunVersion] = useState<SkillVersion | null>(null)
  const [catalogPage, setCatalogPage] = useState(0)
  const [catalogTab, setCatalogTab] = useState<CatalogTabKey>('all')
  const [catalogSort, setCatalogSort] = useState<CatalogSortKey>('recent')
  const [catalogFiltersOpen, setCatalogFiltersOpen] = useState(false)
  const creatorEnabled = runtime.featureFlags?.creatorEnabled ?? runtime.featureFlags?.creator_enabled ?? true

  const tab = normalizeSkillsView(route.tab || 'center')
  const canManageRuntime = hasRuntimeManagementCapability(runtime.capabilities)
  useEffect(() => {
    void Promise.allSettled([runtime.loadPackages(), runtime.loadInstallations(), runtime.loadRuns(), runtime.loadFeatureFlags()])
  }, [])
  useEffect(() => {
    if (tab !== 'artifacts') return
    void Promise.allSettled(runtime.runs.map((run) => runtime.loadArtifacts(run.id)))
  }, [runtime.loadArtifacts, runtime.runs, tab])
  useEffect(() => {
    if (tab !== 'settings') return
    void Promise.allSettled([
      runtime.loadSettings(),
      runtime.loadFeatureFlags(),
      canManageRuntime ? runtime.loadDiagnostics() : Promise.resolve(null),
    ])
  }, [canManageRuntime, runtime.loadDiagnostics, runtime.loadFeatureFlags, runtime.loadSettings, tab])
  useEffect(() => {
    if (typeof window !== 'undefined') window.history.replaceState(null, '', encodeSkillsCenterState(route))
  }, [route])
  useEffect(() => {
    setCatalogPage(0)
  }, [catalogSort, catalogTab, filters.query, filters.source, filters.runtime, filters.status])

  const packageRows = useMemo(() => buildSkillRows(runtime.packages, runtime.installations, runtime.runs), [runtime.packages, runtime.installations, runtime.runs])
  const catalogRows = useMemo(() => filterSkillRows(packageRows, { ...filters, source: 'package', runtime: 'package' }), [packageRows, filters])
  const catalogTabRows = useMemo(() => sortCatalogRows(filterCatalogRowsByTab(catalogRows, catalogTab), catalogSort), [catalogRows, catalogSort, catalogTab])
  const rows = useMemo(() => {
    if (tab === 'center') return paginateCatalogRows(catalogTabRows, catalogPage, SKILLS_CATALOG_PAGE_SIZE)
    if (tab === 'import') return filterSkillRows(packageRows, filters)
    if (tab === 'runs') return filterSkillRows(packageRows.filter((row) => row.run), filters)
    return packageRows
  }, [catalogPage, catalogRows, catalogTabRows, filters, packageRows, tab])
  const selectTab = (next: SkillsCenterTab) => {
    const nextView = normalizeSkillsView(next)
    setRoute({ tab: nextView, selectedPackageId: nextView === 'detail' ? route.selectedPackageId : undefined, draftId: nextView === 'creator' ? route.draftId : undefined })
  }
  const openPackage = async (packageId: string) => {
    setRoute((current) => ({ ...current, tab: 'detail', selectedPackageId: packageId }))
    try { await runtime.loadPackage(packageId) } catch { /* store exposes the actionable error */ }
  }
  const openRun = () => setRoute((current) => ({ ...current, tab: 'runs', selectedPackageId: undefined }))
  const openImport = () => setRoute((current) => ({ ...current, tab: 'import', selectedPackageId: undefined, draftId: undefined }))
  const startRun = (version: SkillVersion) => setRunVersion(version)
  const openCreator = () => { if (!creatorEnabled) return; setRoute((current) => ({ ...current, tab: 'creator', selectedPackageId: undefined })) }
  const createDraft = async () => {
    try {
      const draft = await runtime.createDraft({ content: { runtimeKind: 'package', name: 'New Skill', slug: 'new-skill', description: '', skillMd: '# New Skill\n', references: {}, assets: [], capabilities: [], visibility: 'private' } })
      setRoute({ tab: 'creator', draftId: draft.id })
      setFilters((current) => ({ ...current, query: '' }))
    } catch { /* store exposes the actionable error */ }
  }

  const openCreatorFromInspection = async (item: InspectedPackage) => {
    const manifest = item.manifest
    try {
      const draft = await runtime.createDraft({ content: {
        runtimeKind: 'package',
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
      setRoute({ tab: 'creator', draftId: draft.id })
    } catch { /* store exposes the actionable error */ }
  }

  const refreshRuntime = async () => {
    await Promise.allSettled([runtime.loadPackages(), runtime.loadInstallations(), runtime.loadRuns(), runtime.loadFeatureFlags(), tab === 'settings' && canManageRuntime ? runtime.loadDiagnostics() : Promise.resolve(null)])
  }
  const toggleInstallation = async (row: SkillListRow) => {
    if (!row.installationId) return
    try {
      await runtime.setInstallationEnabled(row.installationId, !row.enabled, row.installationRevision ?? 0)
      await Promise.allSettled([runtime.loadInstallations(), runtime.loadPackages()])
    } catch {
      // Runtime Store owns optimistic rollback and the actionable error toast.
    }
  }
  const createVersion = async (packageId: string) => {
    await openPackage(packageId)
  }
  const createVersionFromVersion = async (version: SkillVersion) => {
    const manifest = (version.manifest || {}) as PackageManifest
    const name = String(manifest.name || selectedPackage?.package.name || 'Updated Skill')
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'updated-skill'
    const currentVersionNumber = version.version.split('.').map((part) => Number.parseInt(part, 10))
    const nextVersion = currentVersionNumber.length === 3 && currentVersionNumber.every((part) => Number.isFinite(part)) ? `${currentVersionNumber[0]}.${currentVersionNumber[1]}.${currentVersionNumber[2] + 1}` : '0.1.0'
    try {
      const draft = await runtime.createDraft({
        baseVersionId: version.id,
        content: {
          runtimeKind: 'package', name, slug, version: nextVersion, description: String(manifest.description || selectedPackage?.package.description || ''),
          skillMd: `# ${name}\n\n${String(manifest.description || '')}\n`,
          references: Object.fromEntries((manifest.references || []).map((reference) => [reference, ''])),
          assets: (manifest.assets || []).map((path) => ({ path })),
          capabilities: manifest.requestedCapabilities || [], visibility: 'private',
        },
      })
      setRoute({ tab: 'creator', draftId: draft.id })
    } catch {
      // Runtime Store exposes the actionable error and toast.
    }
  }
  const uninstallInstallation = async (row: SkillListRow) => {
    if (!row.installationId) return
    const accepted = typeof window === 'undefined' ? true : shouldConfirmCatalogUninstall(row, (message) => window.confirm(message))
    if (!accepted) return
    try {
      await runtime.uninstallPackage(row.installationId, row.installationRevision ?? 0)
      await Promise.allSettled([runtime.loadInstallations(), runtime.loadPackages()])
    } catch {
      // Runtime Store owns optimistic rollback and the actionable error toast.
    }
  }
  const handleGlobalSearch = (query: string) => {
    setFilters((current) => ({ ...current, query }))
    if (tab !== 'center') setRoute((current) => ({ ...current, tab: 'center' }))
  }

  const selectedPackage = runtime.selectedPackage?.package.id === route.selectedPackageId ? runtime.selectedPackage : null
  const selectedVersion = (runtime.selectedVersion && selectedPackage?.versions.some((version) => version.id === runtime.selectedVersion?.id) ? runtime.selectedVersion : undefined) || selectedPackage?.versions.find((version) => version.id === (selectedPackage.installations[0]?.currentVersionId || selectedPackage.installations[0]?.current_version_id)) || selectedPackage?.versions[0]
  const artifactRecords = useMemo(() => buildArtifactExplorerRecords(runtime.runs, runtime.artifactsByRun), [runtime.artifactsByRun, runtime.runs])
  const artifactCounts = useMemo(() => Object.fromEntries(runtime.runs.map((run) => [run.id, runtime.artifactsByRun[run.id]?.length ?? 0])), [runtime.artifactsByRun, runtime.runs])
  const counts = { center: catalogRows.length, import: packageRows.length, creator: Object.keys(runtime.drafts).length, detail: selectedPackage ? 1 : 0, runs: runtime.runs.length, artifacts: artifactRecords.length, settings: runtime.diagnostics ? 1 : 0 }

  const exportArtifact = async (artifact: SkillArtifact) => {
    const destinationDir = typeof window !== 'undefined' ? window.prompt('输入导出目录（服务端会校验权限）：', '')?.trim() : ''
    if (!destinationDir || (typeof window !== 'undefined' && !window.confirm(`确认将 ${artifact.path} 导出到 ${destinationDir}？此操作会记录审计事件。`))) return
    await runtime.exportArtifact(artifact.id, { runId: artifact.runId, destinationDir, confirmed: true, auditReason: 'Exported from Skills Center' })
  }

  const breadcrumb = getSkillsBreadcrumb(tab)
  const showCatalogFilters = tab === 'center' && catalogFiltersOpen
  const visibleRuntimeError = shouldHideSkillsAdminAccessError(runtime.error) ? null : runtime.error
  return <div className="skills-center skills-admin-shell skills-runtime-page" data-testid="skills-admin-shell" data-testid-secondary="skills-center-workbench">
    <header className="skills-center-topbar"><div className="skills-page-title"><Puzzle size={17} /><div><span className="skills-title">Skills Center</span><span className="skills-subtitle">Package Runtime 管理与审计</span></div></div><nav className="skills-breadcrumbs" aria-label="Skills 面包屑">{breadcrumb.map((item, index) => <React.Fragment key={`${item}-${index}`}><span>{item}</span>{index < breadcrumb.length - 1 && <span aria-hidden="true">/</span>}</React.Fragment>)}</nav><div className="skills-center-topbar-tools"><div className="skills-center-search skills-search"><Search size={13} aria-hidden="true" /><input aria-label="搜索 Skills" value={filters.query} onChange={(event) => handleGlobalSearch(event.target.value)} placeholder="搜索名称、来源、运行状态…" /></div><button type="button" className="skills-icon-button" aria-label="刷新 Skills Runtime" title="刷新 Skills Runtime" onClick={() => void refreshRuntime()}><SlidersHorizontal size={14} aria-hidden="true" /></button></div><button type="button" className="skills-tbtn" disabled={!creatorEnabled} onClick={openCreator}><Plus size={13} aria-hidden="true" />打开 Creator</button><button type="button" className="skills-tbtn primary" onClick={openImport}><Upload size={13} aria-hidden="true" />导入 Skill</button></header>
    <div className="skills-center-layout"><SkillsSidebar view={tab} counts={counts} onChange={selectTab} /><main className="skills-center-main">
      {showCatalogFilters && <div className="skills-center-filterbar" aria-label="Skills 筛选"><SlidersHorizontal size={14} aria-hidden="true" /><label>来源<select value={tab === 'center' ? 'package' : filters.source} onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value as SkillsCenterFilters['source'] }))}><option value="all">全部</option><option value="package">Package</option></select></label><label>Runtime<select value={tab === 'center' ? 'package' : filters.runtime} onChange={(event) => setFilters((current) => ({ ...current, runtime: event.target.value as SkillsCenterFilters['runtime'] }))}><option value="all">全部</option><option value="package">Package</option></select></label><label>状态<select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as SkillsCenterFilters['status'] }))}><option value="all">全部</option><option value="enabled">已启用</option><option value="disabled">已禁用</option><option value="attention">需关注</option></select></label><Filter size={14} aria-hidden="true" /><span>{rows.length} 条结果</span></div>}
      {visibleRuntimeError && <div className="skills-page-message"><AlertTriangle size={14} aria-hidden="true" />{visibleRuntimeError}<button type="button" onClick={runtime.clearError} aria-label="关闭提示">×</button></div>}
      {tab === 'creator' && <SkillCreatorWorkbench draftId={route.draftId || null} onCreated={createDraft} onPublished={async (result) => {
        const packageId = getPublishedPackageId(result)
        if (packageId) {
          await openPackage(packageId)
        } else {
          setRoute((current) => ({ ...current, tab: 'center', draftId: undefined }))
        }
      }} />}
      {tab === 'import' && <PackageImportWorkbench onOpenCreator={openCreatorFromInspection} onInstalled={(context) => { if (context.packageId) void openPackage(context.packageId) }} onCancel={() => selectTab('center')} />}
      {tab === 'center' && <SkillOverviewPanel rows={rows} allRows={catalogRows} tab="center" loading={runtime.loading} error={visibleRuntimeError} runs={runtime.runs} page={catalogPage} pageSize={SKILLS_CATALOG_PAGE_SIZE} totalRows={catalogTabRows.length} onPageChange={setCatalogPage} onOpenPackage={openPackage} onOpenRun={openRun} onToggleInstallation={toggleInstallation} onCreateVersion={createVersion} onUninstallInstallation={uninstallInstallation} onInstall={openImport} catalogSearch={filters.query} catalogSort={catalogSort} catalogTab={catalogTab} catalogFiltersOpen={catalogFiltersOpen} onCatalogSearchChange={handleGlobalSearch} onCatalogSortChange={setCatalogSort} onCatalogTabChange={setCatalogTab} onCatalogFilterClick={() => setCatalogFiltersOpen((current) => !current)} />}
      {tab === 'runs' && <RunsWorkbench runs={runtime.runs} artifactCounts={artifactCounts} loading={runtime.loading} error={visibleRuntimeError} onOpenRun={openRun} onRefresh={() => void runtime.loadRuns()} />}
      {tab === 'artifacts' && <ArtifactsWorkbench records={artifactRecords} loading={runtime.loading} error={visibleRuntimeError} onOpenRun={openRun} onExport={exportArtifact} />}
      {tab === 'settings' && <SkillRuntimeSettingsPanel settings={runtime.settings} featureFlags={runtime.featureFlags} diagnostics={runtime.diagnostics} onSaveSettings={runtime.updateSettings} onSaveFeatureFlags={runtime.updateFeatureFlags} onRollback={runtime.rollbackSettings} />}
      {tab === 'detail' && selectedPackage && <div className="skills-center-detail-grid"><SkillVersionPanel versions={selectedPackage.versions} currentVersionId={selectedPackage.installations[0]?.currentVersionId || selectedPackage.installations[0]?.current_version_id} selectedVersionId={selectedVersion?.id} onSelect={runtime.selectVersion} onPreviewUpdate={createVersionFromVersion} /></div>}
    </main></div>
    {selectedPackage && <PackageDetailDrawer detail={selectedPackage} runs={runtime.runs} selectedVersionId={selectedVersion?.id} onSelectVersion={runtime.selectVersion} onCreateVersion={createVersionFromVersion} onClose={() => setRoute((current) => ({ ...current, selectedPackageId: undefined }))} onRun={startRun} onOpenRun={openRun} />}
    {runVersion && <RunSkillDialog version={runVersion} onClose={() => setRunVersion(null)} onStarted={() => openRun()} />}
  </div>
}

function RuntimeViewNotice({ title, body, selected }: { title: string; body: string; selected: boolean }) {
  return <section className="skills-center-panel skills-runtime-view-notice" aria-labelledby={`skills-view-${title}` }><div className="skills-center-panel-head"><div><div className="skills-eyebrow">Package Runtime</div><h2 id={`skills-view-${title}`}>{title}</h2><p>{body}</p></div></div><div className={cn('skills-center-state', selected ? 'success' : 'info')} role="status"><strong>{selected ? '上下文已就绪' : '等待选择资源'}</strong><p>{selected ? '当前上下文会在刷新与视图切换时保留。' : '从 Skills Center、运行记录或导入流程进入该视图。'}</p></div></section>
}

function DraftsPanel({ drafts, onCreate, onOpenDraft, onOpenCreator }: { drafts: Record<string, import('./skill-runtime.types').DraftDto>; onCreate: () => void; onOpenDraft: (id: string) => void; onOpenCreator: () => void }) {
  const entries = Object.values(drafts).filter((draft) => draft.status !== 'discarded')
  return <section className="skills-center-panel" aria-labelledby="skills-drafts-title"><div className="skills-center-panel-head"><div><div className="skills-eyebrow">Creator</div><h2 id="skills-drafts-title">Drafts</h2><p>草稿、revision 和发布动作由 server 管理；当前工作台只提供安全入口。</p></div><button type="button" className="skills-button primary" onClick={onCreate}>新建 Draft</button></div>{entries.length === 0 ? <div className="skills-center-state"><Plus size={18} aria-hidden="true" /><div><strong>还没有 Draft</strong><p>打开 Creator 开始编辑 metadata、SKILL.md 和 capability 请求。</p><button type="button" className="skills-text-button" onClick={onOpenCreator}>打开 Creator</button></div></div> : <div className="skills-runs-list">{entries.map((draft) => <button type="button" className="skills-run-row" key={draft.id} onClick={() => onOpenDraft(draft.id)}><div><strong>{draft.content.name || draft.id}</strong><p>{draft.content.slug} · revision {draft.revision}</p></div><span className="skills-status info">{draft.status || 'draft'}</span></button>)}</div>}</section>
}

function CreatorEntryPanel({ enabled, onCreateDraft }: { enabled: boolean; onCreateDraft: () => void }) {
  return <section className="skills-center-panel" aria-labelledby="skills-creator-title"><div className="skills-center-panel-head"><div><div className="skills-eyebrow"><Plus size={14} /> Skills Creator</div><h2 id="skills-creator-title">从元数据到可验证 Draft</h2><p>Creator 将在此工作台内承载编辑、验证、预览和发布；发布入口受 feature flag 控制。</p></div></div>{!enabled && <div className="skills-message warning">Creator 功能已关闭。现有 Package 查询和审计能力不受影响。</div>}<div className="skills-center-creator-steps"><span>1 Metadata</span><span>2 SKILL.md</span><span>3 Capabilities</span><span>4 Validate / Preview</span><span>5 Publish</span></div><button type="button" className="skills-button primary" disabled={!enabled} onClick={onCreateDraft}>开始本地 Draft</button></section>
}

export function skillSourceLabel(_kind: SkillListRow['kind'], source: string) { return `Package · ${source}` }
