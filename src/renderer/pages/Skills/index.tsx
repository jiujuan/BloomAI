import React, { useEffect, useMemo, useState } from 'react'
import { Box, Check, Download, Github, History, Plus, Puzzle, Search } from 'lucide-react'
import { useSkillsStore } from '@renderer/pages/Skills/skills.store'
import { SkillEditor } from './SkillEditor'
import { PackageInstallDialog } from './PackageInstallDialog'
import { PackageDetailDrawer } from './PackageDetailDrawer'
import { RunDetailDrawer, RunSkillDialog } from './RunDetailDrawer'
import { useSkillRuntimeStore } from './skill-runtime.store'
import { formatDate } from './skill-runtime.types'
import type { SkillPackage, SkillRun, SkillVersion } from './skill-runtime.types'
import { cn } from '@renderer/utils'

const TYPE_BADGE: Record<string, string> = { 'js-function': 'JS', 'http-api': 'HTTP', 'prompt-template': 'Prompt' }
const TYPE_ICON: Record<string, string> = { 'js-function': '⚙️', 'http-api': '🌐', 'prompt-template': '💬' }
type Tab = 'installed' | 'market' | 'runs'

export function SkillsMarket() {
  const legacy = useSkillsStore()
  const runtime = useSkillRuntimeStore()
  const [tab, setTab] = useState<Tab>('installed')
  const [query, setQuery] = useState('')
  const [showEditor, setShowEditor] = useState(false)
  const [showInstaller, setShowInstaller] = useState(false)
  const [runVersion, setRunVersion] = useState<SkillVersion | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  useEffect(() => { void legacy.loadInstalled(); void legacy.loadMarket(); void runtime.loadPackages(); void runtime.loadRuns() }, [])

  const filteredPackages = useMemo(() => runtime.packages.filter((item) => matches(item.name, item.description, query)), [runtime.packages, query])
  const filteredRuns = useMemo(() => runtime.runs.filter((run) => matches(run.status, run.id, query)), [runtime.runs, query])
  const installedIds = new Set(legacy.installed.map((skill) => skill.id))
  const legacyMarket = legacy.market.filter((skill) => (!installedIds.has(skill.id) || !skill.is_installed) && matches(skill.name, skill.description, query))

  const selectPackage = async (item: SkillPackage) => { try { await runtime.loadPackage(item.id) } catch (error) { console.error(error) } }
  const selectRun = async (runId: string) => { setSelectedRunId(runId) }
  const onSearch = (value: string) => { setQuery(value); if (tab === 'market') void legacy.loadMarket(value) }

  return <div className="skills-page skills-runtime-page">
    <header className="skills-topbar"><div className="skills-page-title"><Puzzle size={17} /><div><span className="skills-title">Skills</span><span className="skills-subtitle">Package runtime 管理与审计</span></div></div><div className="skills-search"><Search size={13} /><input value={query} onChange={(event) => onSearch(event.target.value)} placeholder={tab === 'runs' ? '搜索 Run 状态或 ID…' : '搜索 Skills…'} /></div><button className="skills-tbtn" onClick={() => setShowEditor(true)}><Plus size={13} />Create Legacy Skill</button><button className="skills-tbtn primary" onClick={() => setShowInstaller(true)}><Github size={13} />安装 GitHub Package</button></header>
    <nav className="skills-tabs" aria-label="Skills 分类">{([['installed', 'Installed', runtime.packages.length + legacy.installed.length], ['market', 'Market', legacyMarket.length], ['runs', 'Runs', runtime.runs.length]] as Array<[Tab, string, number]>).map(([id, label, count]) => <button key={id} className={cn('skills-tab', tab === id && 'active')} onClick={() => setTab(id)}>{label}<span>{count}</span></button>)}</nav>
    {runtime.error && <div className="skills-page-message">{runtime.error}<button onClick={runtime.clearError} aria-label="关闭提示">×</button></div>}
    <main className="skills-workspace">
      {tab === 'installed' && <InstalledTab packages={filteredPackages} legacySkills={legacy.installed.filter((skill) => matches(skill.name, skill.description, query))} onOpenPackage={selectPackage} onUninstallLegacy={(id) => void legacy.uninstallSkill(id)} />}
      {tab === 'market' && <MarketTab skills={legacyMarket} onInstall={(id) => void legacy.installSkill(id)} onOpenInstaller={() => setShowInstaller(true)} />}
      {tab === 'runs' && <RunsTab runs={filteredRuns} onOpenRun={selectRun} />}
    </main>
    {showEditor && <SkillEditor onClose={() => setShowEditor(false)} />}
    {showInstaller && <PackageInstallDialog onClose={() => setShowInstaller(false)} />}
    {runtime.selectedPackage && <PackageDetailDrawer detail={runtime.selectedPackage} runs={runtime.runs} onClose={() => useSkillRuntimeStore.setState({ selectedPackage: null })} onRun={setRunVersion} onOpenRun={selectRun} />}
    {runVersion && <RunSkillDialog version={runVersion} onClose={() => setRunVersion(null)} onStarted={selectRun} />}
    {selectedRunId && <RunDetailDrawer runId={selectedRunId} onClose={() => setSelectedRunId(null)} />}
  </div>
}

function InstalledTab({ packages, legacySkills, onOpenPackage, onUninstallLegacy }: { packages: SkillPackage[]; legacySkills: any[]; onOpenPackage: (item: SkillPackage) => void; onUninstallLegacy: (id: string) => void }) {
  return <div className="skills-tab-content"><section className="skills-section"><div className="skills-section-head"><div><span className="skills-section-title">Package Skills</span><p>已安装的版本快照、权限与运行记录。</p></div></div>{packages.length === 0 ? <EmptyState title="还没有 Package Skill" body="通过 GitHub URL 安装固定 commit、tag 或 branch；安装前会检查 Manifest 和权限声明。" /> : <div className="skills-package-grid">{packages.map((item) => <button className="skills-package-card" key={item.id} onClick={() => onOpenPackage(item)}><div className="skills-card-title"><Box size={17} /><strong>{item.name}</strong><span className="skills-status info">Package</span></div><p>{item.description || '未提供描述'}</p><div className="skills-card-footer"><span>{item.source_type}</span><span>{formatDate(item.updated_at)}</span></div></button>)}</div>}</section><section className="skills-section"><div className="skills-section-head"><div><span className="skills-section-title">Legacy Skills</span><p>旧同步运行机制仍可用；Package Skill 不会通过该接口执行。</p></div></div><div className="skills-grid">{legacySkills.map((skill) => <LegacySkillCard key={skill.id} skill={skill} installed onUninstall={() => onUninstallLegacy(skill.id)} />)}{legacySkills.length === 0 && <EmptyState title="没有匹配的 Legacy Skill" body="可从 Market 安装或创建一个轻量 Skill。" />}</div></section></div>
}

function MarketTab({ skills, onInstall, onOpenInstaller }: { skills: any[]; onInstall: (id: string) => void; onOpenInstaller: () => void }) {
  return <div className="skills-tab-content"><section className="skills-market-hero"><div><div className="skills-eyebrow"><Github size={14} />Package Market</div><h2>从可信 GitHub 来源安装</h2><p>先检查 manifest、B-Lite 兼容性和权限差异，再安装一个固定 ref 的本地快照。更新时请重新安装新的固定版本。</p></div><button className="skills-button primary" onClick={onOpenInstaller}><Github size={14} />检查并安装</button></section><section className="skills-section"><div className="skills-section-head"><div><span className="skills-section-title">Legacy 市场</span><p>保留既有轻量 Skill 市场以兼容现有工作流。</p></div></div><div className="skills-grid">{skills.map((skill) => <LegacySkillCard key={skill.id} skill={skill} onInstall={() => onInstall(skill.id)} />)}{skills.length === 0 && <EmptyState title="没有匹配的市场 Skill" body="尝试更换关键词，或通过 GitHub URL 安装 Package Skill。" />}</div></section></div>
}

function RunsTab({ runs, onOpenRun }: { runs: SkillRun[]; onOpenRun: (id: string) => void }) {
  return <div className="skills-tab-content"><section className="skills-section"><div className="skills-section-head"><div><span className="skills-section-title">所有 Package Runs</span><p>横跨 Skills、Chat 和 AI 画图的运行审计记录。</p></div></div>{runs.length === 0 ? <EmptyState title="暂无 Package Run" body="从已安装 Package 的详情页发起一次调试运行后，可在此查看事件和 Artifacts。" /> : <div className="skills-runs-list">{runs.map((run) => <button key={run.id} className="skills-run-row" onClick={() => onOpenRun(run.id)}><div><strong>{run.status}</strong><p>{run.skillVersionId}</p></div><div className="skills-run-meta"><span>{run.surface || 'skills'}</span><span>{formatDate(run.updatedAt)}</span><History size={15} /></div></button>)}</div>}</section></div>
}

function LegacySkillCard({ skill, installed, onInstall, onUninstall }: { skill: any; installed?: boolean; onInstall?: () => void; onUninstall?: () => void }) { return <div className={cn('skill-card', installed && 'installed')}><div className="skill-card-top"><div className="skill-card-icon">{TYPE_ICON[skill.type]}</div><div className="skill-card-info"><div className="skill-card-name">{skill.name}</div><div className="skill-card-author">Legacy · {skill.author === 'official' ? 'Official' : skill.author === 'community' ? 'Community' : 'Custom'}</div></div></div><div className="skill-card-desc">{skill.description}</div><div className="skill-card-foot"><span className="skill-type-badge">{TYPE_BADGE[skill.type]}</span>{installed ? <button className="skills-text-button danger" onClick={onUninstall}>卸载</button> : <><span className="skill-install-count"><Download size={10} /> {skill.install_count}</span><button className="skill-install-btn" onClick={onInstall}><Plus size={11} /> Install</button></>}</div></div> }

function EmptyState({ title, body }: { title: string; body: string }) { return <div className="skills-empty-state"><Check size={18} /><div><strong>{title}</strong><p>{body}</p></div></div> }
function matches(...values: Array<string | null | undefined>) { const query = values.pop(); const needle = String(query || '').trim().toLowerCase(); return !needle || values.some((value) => value?.toLowerCase().includes(needle)) }
