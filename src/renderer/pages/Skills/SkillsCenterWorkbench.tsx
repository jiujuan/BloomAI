import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Filter, Github, Plus, Puzzle, Search, SlidersHorizontal } from 'lucide-react'
import { useSkillsStore } from './skills.store'
import type { Skill } from './skills.store'
import { useSkillRuntimeStore } from './skill-runtime.store'
import { getPublishedPackageId } from './skill-runtime.types'
import type { InspectedPackage, PackageManifest, SkillArtifact, SkillInstallation, SkillPackage, SkillRun, SkillRuntimeCapabilities, SkillRuntimeFilterStatus, SkillRuntimeSourceFilter, SkillVersion } from './skill-runtime.types'
import { PackageDetailDrawer } from './PackageDetailDrawer'
import { PackageInstallDialog } from './PackageInstallDialog'
import { RunDetailDrawer, RunSkillDialog } from './RunDetailDrawer'
import { SkillCapabilityPanel } from './SkillCapabilityPanel'
import { paginateCatalogRows, shouldConfirmCatalogUninstall, SkillOverviewPanel } from './SkillOverviewPanel'
import { SkillVersionPanel } from './SkillVersionPanel'
import { getSkillsBreadcrumb, normalizeSkillsView, SkillsSidebar } from './SkillsSidebar'
import type { SkillsCenterTab as SkillsRouteTab, SkillsRuntimeView } from './SkillsSidebar'
import { SkillCreatorWorkbench } from './SkillCreatorWorkbench'
import { SkillRuntimeDiagnostics } from './SkillRuntimeDiagnostics'
import { RunsWorkbench } from './RunsWorkbench'
import { ArtifactsWorkbench } from './ArtifactsWorkbench'
import { SkillRuntimeSettingsPanel } from './SkillRuntimeSettingsPanel'
import { cn } from '@renderer/utils'

export type SkillsCenterTab = SkillsRouteTab
export type SkillsCenterFilters = { query: string; source: SkillRuntimeSourceFilter; runtime: SkillRuntimeSourceFilter | 'all'; status: SkillRuntimeFilterStatus }

const SKILLS_CATALOG_PAGE_SIZE = 10
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
  installationId?: string
  installationRevision?: number
}

type SkillsCenterRouteState = { tab?: SkillsCenterTab; selectedPackageId?: string; selectedRunId?: string; draftId?: string }

export function getRunSkillLabel(run: SkillRun) {
  return run.version ? `${run.version.source || 'Package Runtime'} · v${run.version.version}` : 'Package Runtime'
}

export function buildArtifactExplorerRecords(runs: SkillRun[], artifactsByRun: Record<string, import('./skill-runtime.types').SkillArtifact[]>) {
  return runs.flatMap((run) => (artifactsByRun[run.id] ?? []).map((artifact) => ({ artifact, skillLabel: getRunSkillLabel(run) })))
}
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
      installationId: installation?.id, installationRevision: installation?.revision ?? 0,
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
  const tab = rawTab === 'installed' || rawTab === 'available' || rawTab === 'runs' || rawTab === 'drafts' || rawTab === 'creator' || rawTab === 'center' || rawTab === 'import' || rawTab === 'detail' || rawTab === 'permissions' || rawTab === 'run-detail' || rawTab === 'artifacts' || rawTab === 'settings' ? rawTab as SkillsCenterTab : undefined
  return { tab, selectedPackageId: values.get('package') || undefined, selectedRunId: values.get('run') || undefined, draftId: values.get('draft') || undefined }
}

export function getRuntimeStatusLabel(capabilities: Pick<SkillRuntimeCapabilities, 'operationalStatus'> | null) {
  if (!capabilities) return 'Runtime Checking'
  if (capabilities.operationalStatus === 'ready') return 'Runtime Ready'
  if (capabilities.operationalStatus === 'disabled') return 'Runtime Disabled'
  return 'Runtime Degraded'
}

export function hasRuntimeManagementCapability(capabilities: Pick<SkillRuntimeCapabilities, 'canManage'> | null) {
  return capabilities?.canManage === true
}

export function SkillsCenterWorkbench() {
  const legacy = useSkillsStore()
  const runtime = useSkillRuntimeStore()
  const [route, setRoute] = useState<SkillsCenterRouteState>(() => typeof window === 'undefined' ? {} : decodeSkillsCenterState(window.location.hash))
  const [filters, setFilters] = useState<SkillsCenterFilters>({ query: '', source: 'all', runtime: 'all', status: 'all' })
  const [showInstaller, setShowInstaller] = useState(false)
  const [runVersion, setRunVersion] = useState<SkillVersion | null>(null)
  const [catalogPage, setCatalogPage] = useState(0)
  const creatorEnabled = runtime.featureFlags?.creatorEnabled ?? runtime.featureFlags?.creator_enabled ?? true

  const tab = normalizeSkillsView(route.tab || 'center')
  const canManageRuntime = hasRuntimeManagementCapability(runtime.capabilities)
  const runtimeStatus = runtime.capabilities?.operationalStatus ?? 'degraded'
  const runtimeStatusLabel = getRuntimeStatusLabel(runtime.capabilities)
  useEffect(() => {
    void Promise.allSettled([legacy.loadInstalled(), legacy.loadMarket(), runtime.loadPackages(), runtime.loadInstallations(), runtime.loadRuns(), runtime.loadFeatureFlags()])
  }, [])
  useEffect(() => {
    if (canManageRuntime) void runtime.loadDiagnostics().catch(() => undefined)
  }, [canManageRuntime, runtime.loadDiagnostics])
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
  }, [filters.query, filters.source, filters.runtime, filters.status])

  const allRows = useMemo(() => buildSkillRows(runtime.packages, legacy.installed, runtime.installations, runtime.runs), [runtime.packages, legacy.installed, runtime.installations, runtime.runs])
  const packageRows = useMemo(() => buildSkillRows(runtime.packages, [], runtime.installations, runtime.runs), [runtime.packages, runtime.installations, runtime.runs])
  const legacyRows = useMemo(() => buildSkillRows([], tab === 'import' ? legacy.market : legacy.installed, [], []), [legacy.installed, legacy.market, tab])
  const catalogRows = useMemo(() => filterSkillRows(packageRows, { ...filters, source: 'package', runtime: 'package' }), [packageRows, filters])
  const rows = useMemo(() => {
    if (tab === 'center') return paginateCatalogRows(catalogRows, catalogPage, SKILLS_CATALOG_PAGE_SIZE)
    if (tab === 'import') return filterSkillRows([...packageRows, ...legacyRows], filters)
    if (tab === 'runs') return filterSkillRows(allRows.filter((row) => row.run), filters)
    return allRows
  }, [allRows, catalogPage, catalogRows, filters, legacyRows, packageRows, tab])
  const selectTab = (next: SkillsCenterTab) => {
    const nextView = normalizeSkillsView(next)
    setRoute({ tab: nextView, selectedPackageId: ['detail', 'permissions'].includes(nextView) ? route.selectedPackageId : undefined, selectedRunId: nextView === 'run-detail' ? route.selectedRunId : undefined, draftId: nextView === 'creator' ? route.draftId : undefined })
  }
  const openPackage = async (packageId: string) => {
    setRoute((current) => ({ ...current, tab: 'detail', selectedPackageId: packageId }))
    try { await runtime.loadPackage(packageId) } catch { /* store exposes the actionable error */ }
  }
  const openRun = (runId: string) => setRoute((current) => ({ ...current, tab: 'run-detail', selectedRunId: runId }))
  const openGrantContext = async (packageOrRunId: string) => {
    if (runtime.packages.some((item) => item.id === packageOrRunId)) {
      setRoute((current) => ({ ...current, tab: 'permissions', selectedPackageId: packageOrRunId, selectedRunId: undefined }))
      try { await runtime.loadPackage(packageOrRunId) } catch { /* store exposes the actionable error */ }
      return
    }
    setRoute((current) => ({ ...current, tab: 'run-detail', selectedRunId: packageOrRunId }))
  }
  const startRun = (version: SkillVersion) => setRunVersion(version)
  const openCreator = () => { if (!creatorEnabled) return; setRoute((current) => ({ ...current, tab: 'creator', selectedPackageId: undefined, selectedRunId: undefined })) }
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
      setShowInstaller(false)
      setRoute({ tab: 'creator', draftId: draft.id })
    } catch { /* store exposes the actionable error */ }
  }

  const refreshRuntime = async () => {
    await Promise.allSettled([runtime.loadPackages(), runtime.loadInstallations(), runtime.loadRuns(), runtime.loadFeatureFlags(), canManageRuntime ? runtime.loadDiagnostics() : Promise.resolve(null)])
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
  const manifest = selectedVersion?.manifest as PackageManifest | undefined
  const selectedVersionGrants = selectedPackage?.capabilityGrants.filter((grant) => (grant.skillVersionId || grant.skill_version_id) === selectedVersion?.id) ?? []
  const artifactRecords = useMemo(() => buildArtifactExplorerRecords(runtime.runs, runtime.artifactsByRun), [runtime.artifactsByRun, runtime.runs])
  const artifactCounts = useMemo(() => Object.fromEntries(runtime.runs.map((run) => [run.id, runtime.artifactsByRun[run.id]?.length ?? 0])), [runtime.artifactsByRun, runtime.runs])
  const counts = { center: catalogRows.length, import: packageRows.length, creator: Object.keys(runtime.drafts).length, detail: selectedPackage ? 1 : 0, permissions: selectedPackage?.capabilityGrants.length ?? 0, runs: runtime.runs.length, 'run-detail': route.selectedRunId ? 1 : 0, artifacts: artifactRecords.length, settings: runtime.diagnostics ? 1 : 0 }

  const approveGrant = async (grant: NonNullable<typeof selectedPackage>['capabilityGrants'][number]) => {
    if (typeof window !== 'undefined' && !window.confirm(`批准 ${grant.capability} 将允许当前 Package 使用以下 scope：${JSON.stringify(grant.scope)}。是否继续？`)) return
    await runtime.approve(grant.id, { actor: 'skills-center' })
  }
  const rejectGrant = async (grant: NonNullable<typeof selectedPackage>['capabilityGrants'][number]) => {
    if (typeof window !== 'undefined' && !window.confirm(`拒绝 ${grant.capability} 后，相关 Run 可能保持 waiting_approval。是否继续？`)) return
    await runtime.reject(grant.id, { actor: 'skills-center', reason: 'Rejected from Skills Center' })
  }
  const exportArtifact = async (artifact: SkillArtifact) => {
    const destinationDir = typeof window !== 'undefined' ? window.prompt('输入导出目录（服务端会校验权限）：', '')?.trim() : ''
    if (!destinationDir || (typeof window !== 'undefined' && !window.confirm(`确认将 ${artifact.path} 导出到 ${destinationDir}？此操作会记录审计事件。`))) return
    await runtime.exportArtifact(artifact.id, { runId: artifact.runId, destinationDir, confirmed: true, auditReason: 'Exported from Skills Center' })
  }

  const breadcrumb = getSkillsBreadcrumb(tab)
  const showCatalogFilters = tab === 'center' || tab === 'import'
  return <div className="skills-center skills-admin-shell" data-testid="skills-admin-shell" data-testid-secondary="skills-center-workbench">
    <header className="skills-center-topbar"><div className="skills-page-title"><Puzzle size={17} /><div><span className="skills-title">Skills Center</span><span className="skills-subtitle">Package Runtime 管理与审计</span></div></div><nav className="skills-breadcrumbs" aria-label="Skills 面包屑">{breadcrumb.map((item, index) => <React.Fragment key={`${item}-${index}`}><span>{item}</span>{index < breadcrumb.length - 1 && <span aria-hidden="true">/</span>}</React.Fragment>)}</nav><div className="skills-center-topbar-tools"><span className="skills-runtime-context"><span className="skills-runtime-context-dot" aria-hidden="true" />Runtime Healthy · Worker</span><span className={cn('skills-runtime-status', runtimeStatus === 'ready' ? 'success' : runtimeStatus === 'disabled' ? 'muted' : 'warning')} role="status" aria-label={runtimeStatusLabel}>{runtimeStatusLabel}</span><div className="skills-center-search skills-search"><Search size={13} aria-hidden="true" /><input aria-label="搜索 Skills" value={filters.query} onChange={(event) => handleGlobalSearch(event.target.value)} placeholder="搜索名称、来源、运行状态…" /></div><button type="button" className="skills-icon-button" aria-label="刷新 Skills Runtime" title="刷新 Skills Runtime" onClick={() => void refreshRuntime()}><SlidersHorizontal size={14} aria-hidden="true" /></button></div><button type="button" className="skills-tbtn" disabled={!creatorEnabled} onClick={openCreator}><Plus size={13} aria-hidden="true" />打开 Creator</button><button type="button" className="skills-tbtn primary" onClick={() => setShowInstaller(true)}><Github size={13} aria-hidden="true" />导入 Package</button></header>
    {canManageRuntime && <SkillRuntimeDiagnostics diagnostics={runtime.diagnostics} loading={runtime.diagnosticsLoading} error={runtime.diagnosticsError} onRefresh={() => void runtime.loadDiagnostics().catch(() => undefined)} />}
    <div className="skills-center-layout"><SkillsSidebar view={tab} counts={counts} onChange={selectTab} /><main className="skills-center-main">
      {showCatalogFilters && <div className="skills-center-filterbar" aria-label="Skills 筛选"><SlidersHorizontal size={14} aria-hidden="true" /><label>来源<select value={tab === 'center' ? 'package' : filters.source} onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value as SkillsCenterFilters['source'] }))}><option value="all">全部</option><option value="package">Package</option>{tab !== 'center' && <option value="legacy">Legacy</option>}</select></label><label>Runtime<select value={tab === 'center' ? 'package' : filters.runtime} onChange={(event) => setFilters((current) => ({ ...current, runtime: event.target.value as SkillsCenterFilters['runtime'] }))}><option value="all">全部</option><option value="package">Package</option>{tab !== 'center' && <option value="legacy">Legacy</option>}</select></label><label>状态<select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as SkillsCenterFilters['status'] }))}><option value="all">全部</option><option value="enabled">已启用</option><option value="disabled">已禁用</option><option value="attention">需关注</option></select></label><Filter size={14} aria-hidden="true" /><span>{rows.length} 条结果</span></div>}
      {runtime.error && <div className="skills-page-message"><AlertTriangle size={14} aria-hidden="true" />{runtime.error}<button type="button" onClick={runtime.clearError} aria-label="关闭提示">×</button></div>}
      {tab === 'creator' && <SkillCreatorWorkbench draftId={route.draftId || null} onCreated={createDraft} onPublished={async (result) => {
        const packageId = getPublishedPackageId(result)
        if (packageId) {
          await openPackage(packageId)
        } else {
          setRoute((current) => ({ ...current, tab: 'center', draftId: undefined }))
        }
      }} />}
      {(tab === 'center' || tab === 'import') && <SkillOverviewPanel rows={rows} tab={tab === 'center' ? 'installed' : 'available'} loading={runtime.loading || (tab !== 'center' && legacy.loading)} error={runtime.error} runs={runtime.runs} page={catalogPage} pageSize={SKILLS_CATALOG_PAGE_SIZE} totalRows={tab === 'center' ? catalogRows.length : undefined} onPageChange={setCatalogPage} onOpenPackage={openPackage} onOpenRun={openRun} onOpenGrant={openGrantContext} onToggleInstallation={toggleInstallation} onCreateVersion={createVersion} onUninstallInstallation={uninstallInstallation} onInstall={() => setShowInstaller(true)} />}
      {tab === 'runs' && <RunsWorkbench runs={runtime.runs} artifactCounts={artifactCounts} loading={runtime.loading} error={runtime.error} onOpenRun={openRun} onRefresh={() => void runtime.loadRuns()} />}
      {tab === 'artifacts' && <ArtifactsWorkbench records={artifactRecords} loading={runtime.loading} error={runtime.error} onOpenRun={openRun} onExport={exportArtifact} />}
      {tab === 'settings' && <SkillRuntimeSettingsPanel settings={runtime.settings} featureFlags={runtime.featureFlags} diagnostics={runtime.diagnostics} onSaveSettings={runtime.updateSettings} onSaveFeatureFlags={runtime.updateFeatureFlags} onRollback={runtime.rollbackSettings} />}
      {(tab === 'detail' || tab === 'permissions') && selectedPackage && <div className="skills-center-detail-grid"><SkillVersionPanel versions={selectedPackage.versions} currentVersionId={selectedPackage.installations[0]?.currentVersionId || selectedPackage.installations[0]?.current_version_id} selectedVersionId={selectedVersion?.id} onSelect={runtime.selectVersion} onPreviewUpdate={createVersionFromVersion} /><SkillCapabilityPanel manifest={manifest} grants={selectedVersionGrants} versionId={selectedVersion?.id} versionLabel={`v${selectedVersion?.version || '—'} · ${selectedVersion?.id === (selectedPackage.installations[0]?.currentVersionId || selectedPackage.installations[0]?.current_version_id) ? '当前版本' : '历史版本'}`} onApprove={approveGrant} onReject={rejectGrant} /></div>}
    </main></div>
    {showInstaller && <PackageInstallDialog onClose={() => setShowInstaller(false)} onOpenCreator={openCreatorFromInspection} onInstalled={(context) => { if (context.packageId) void openPackage(context.packageId) }} />}
    {selectedPackage && <PackageDetailDrawer detail={selectedPackage} runs={runtime.runs} selectedVersionId={selectedVersion?.id} onSelectVersion={runtime.selectVersion} onCreateVersion={createVersionFromVersion} onClose={() => setRoute((current) => ({ ...current, selectedPackageId: undefined }))} onRun={startRun} onOpenRun={openRun} />}
    {route.selectedRunId && <RunDetailDrawer runId={route.selectedRunId} onClose={() => setRoute((current) => ({ ...current, selectedRunId: undefined }))} />}
    {runVersion && <RunSkillDialog version={runVersion} onClose={() => setRunVersion(null)} onStarted={openRun} />}
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
  return <section className="skills-center-panel" aria-labelledby="skills-creator-title"><div className="skills-center-panel-head"><div><div className="skills-eyebrow"><Plus size={14} /> Skills Creator</div><h2 id="skills-creator-title">从元数据到可验证 Draft</h2><p>Creator 将在此工作台内承载编辑、验证、预览和发布；发布入口受 feature flag 控制。</p></div></div>{!enabled && <div className="skills-message warning">Creator 功能已关闭。现有 Legacy、Package 查询和审计能力不受影响。</div>}<div className="skills-center-creator-steps"><span>1 Metadata</span><span>2 SKILL.md</span><span>3 Capabilities</span><span>4 Validate / Preview</span><span>5 Publish</span></div><button type="button" className="skills-button primary" disabled={!enabled} onClick={onCreateDraft}>开始本地 Draft</button></section>
}

export function skillSourceLabel(kind: SkillListRow['kind'], source: string) { return `${kind === 'package' ? 'Package' : 'Legacy'} · ${source}` }
