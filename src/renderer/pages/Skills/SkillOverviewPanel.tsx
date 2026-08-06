import React from 'react'
import { Box, ChevronRight, CircleAlert, FileCode2, History, PackageCheck, Puzzle, ShieldCheck } from 'lucide-react'
import type { SkillListRow } from './SkillsCenterWorkbench'
import type { SkillRun } from './skill-runtime.types'
import { formatDate } from './skill-runtime.types'

type SkillOverviewPanelProps = {
  rows: SkillListRow[]
  tab: 'installed' | 'available' | 'runs'
  loading: boolean
  onOpenPackage: (packageId: string) => void
  onOpenRun: (runId: string) => void
  onInstall: () => void
}

export function SkillOverviewPanel({ rows, tab, loading, onOpenPackage, onOpenRun, onInstall }: SkillOverviewPanelProps) {
  if (tab === 'runs') return <RunOverview rows={rows} loading={loading} onOpenRun={onOpenRun} />
  return <section className="skills-center-panel" aria-labelledby="skills-overview-title">
    <div className="skills-center-panel-head"><div><div className="skills-eyebrow"><PackageCheck size={14} /> Skills inventory</div><h2 id="skills-overview-title">{tab === 'available' ? 'Available / Import' : 'Installed Skills'}</h2><p>{tab === 'available' ? '先检查来源和 manifest，再安装固定快照；Legacy 市场仍保留兼容入口。' : '统一查看 Legacy 与 Package，但两者的运行边界和生命周期操作保持明确区分。'}</p></div>{tab === 'available' && <button type="button" className="skills-button primary" onClick={onInstall}>导入 Package</button>}</div>
    {loading && <div className="skills-center-state" role="status">正在加载 Skills inventory…</div>}
    {!loading && rows.length === 0 && <div className="skills-center-state"><CircleAlert size={18} aria-hidden="true" /><div><strong>{tab === 'available' ? '暂无可导入 Package' : '暂无匹配的 Skill'}</strong><p>尝试调整顶部筛选，或通过“导入 Package”开始一次受控检查。</p></div></div>}
    {!loading && rows.length > 0 && <div className="skills-center-table-wrap"><table className="skills-center-table"><caption className="sr-only">Skills inventory</caption><thead><tr><th>Skill</th><th>来源 / Runtime</th><th>版本</th><th>状态</th><th>风险 / 能力</th><th>最近运行</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.kind}:${row.id}`}><td><div className="skills-center-skill-cell"><span className={'skills-center-kind-icon ' + row.kind} aria-hidden="true">{row.kind === 'package' ? <Box size={15} /> : <Puzzle size={15} />}</span><div><strong>{row.name}</strong><small>{row.description || '未提供描述'}</small></div></div></td><td><span className="skills-center-source-label">{row.sourceLabel}</span><small>{row.runtime}</small></td><td className="skills-center-mono">{row.version}</td><td><span className={'skills-status ' + row.statusTone}>{row.statusLabel}</span></td><td><span className={'skills-status ' + row.riskTone}>{row.riskLabel}</span><small>{row.capabilities.length ? row.capabilities.join(' · ') : '无额外能力'}</small></td><td>{row.lastRunAt ? formatDate(row.lastRunAt) : '—'}</td><td className="skills-center-actions">{row.kind === 'package' ? <button type="button" className="skills-text-button" onClick={() => onOpenPackage(row.id)}>详情 <ChevronRight size={13} aria-hidden="true" /></button> : <span className="skills-center-legacy-note">Legacy-only</span>}</td></tr>)}</tbody></table></div>}
  </section>
}

function RunOverview({ rows, loading, onOpenRun }: { rows: SkillListRow[]; loading: boolean; onOpenRun: (runId: string) => void }) {
  const runs = rows.flatMap((row) => row.run ? [row.run] : [])
  return <section className="skills-center-panel" aria-labelledby="skills-runs-title"><div className="skills-center-panel-head"><div><div className="skills-eyebrow"><History size={14} /> Observe / Runtime</div><h2 id="skills-runs-title">Runs</h2><p>查看状态、审批、事件和 Artifact；停止新 Run 不会删除既有审计记录。</p></div></div>{loading && <div className="skills-center-state" role="status">正在加载 Runs…</div>}{!loading && runs.length === 0 && <div className="skills-center-state"><CircleAlert size={18} aria-hidden="true" /><div><strong>暂无 Package Run</strong><p>从已安装 Package 的详情页发起运行后，这里会保留可查询的审计记录。</p></div></div>}{!loading && runs.length > 0 && <div className="skills-center-run-list">{runs.map((run) => <button type="button" className="skills-center-run-row" key={run.id} onClick={() => onOpenRun(run.id)}><div><strong className="skills-center-mono">{run.id}</strong><span>{run.skillVersionId} · {run.surface || 'skills'}</span></div><div><span className={'skills-status ' + runTone(run.status)}>{run.status}</span><time>{formatDate(run.updatedAt)}</time><ChevronRight size={14} aria-hidden="true" /></div></button>)}</div>}</section>
}

function runTone(status: SkillRun['status']) { if (status === 'completed') return 'success'; if (status === 'failed' || status === 'cancelled') return 'danger'; if (status.startsWith('waiting')) return 'warning'; return 'info' }
