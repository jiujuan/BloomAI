import React, { useEffect, useMemo, useState } from 'react'
import { Activity, CheckCircle2, Info, RotateCcw, Save, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import type { SkillRuntimeDiagnosticsSnapshot, SkillRuntimeFeatureFlags, SkillRuntimeSettings } from './skill-runtime.types'

type SettingsGroupKey = 'runtime' | 'import' | 'security' | 'artifacts'
type SettingsPanelProps = {
  settings: SkillRuntimeSettings | null
  featureFlags: SkillRuntimeFeatureFlags | null
  diagnostics: SkillRuntimeDiagnosticsSnapshot | null
  onSaveSettings: (patch: Record<string, unknown>) => Promise<SkillRuntimeSettings | void>
  onSaveFeatureFlags: (patch: Record<string, boolean>) => Promise<SkillRuntimeFeatureFlags | void>
  onRollback: () => Promise<SkillRuntimeSettings | void>
}

const EMPTY_SETTINGS: SkillRuntimeSettings = { runtime: {}, import: {}, security: {}, artifacts: {} }
const GROUP_LABELS: Record<SettingsGroupKey, string> = { runtime: 'Runtime', import: 'Import', security: 'Security', artifacts: 'Artifacts' }

export function SkillRuntimeSettingsPanel({ settings, featureFlags, diagnostics, onSaveSettings, onSaveFeatureFlags, onRollback }: SettingsPanelProps) {
  const [draftSettings, setDraftSettings] = useState<SkillRuntimeSettings>(settings ?? EMPTY_SETTINGS)
  const [draftFlags, setDraftFlags] = useState<SkillRuntimeFeatureFlags>(featureFlags ?? {})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => { if (settings) setDraftSettings(settings) }, [settings])
  useEffect(() => { if (featureFlags) setDraftFlags(featureFlags) }, [featureFlags])
  const health = diagnostics?.health
  const healthLabel = health?.availability || health?.status || (diagnostics ? 'unknown' : 'checking')
  const healthTone = healthLabel === 'healthy' || healthLabel === 'ready' ? 'success' : healthLabel === 'disabled' ? 'muted' : healthLabel === 'checking' ? 'info' : 'warning'

  const save = async () => {
    setBusy(true); setMessage(null)
    try {
      await onSaveSettings({ runtime: draftSettings.runtime, import: draftSettings.import, security: draftSettings.security, artifacts: draftSettings.artifacts })
      await onSaveFeatureFlags({ ...draftFlags })
      setMessage('设置已保存')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '设置保存失败')
    } finally { setBusy(false) }
  }
  const rollback = async () => {
    setBusy(true); setMessage(null)
    try { await onRollback(); setMessage('设置已回滚') } catch (error) { setMessage(error instanceof Error ? error.message : '设置回滚失败') } finally { setBusy(false) }
  }
  const updateSetting = (group: SettingsGroupKey, key: string, value: unknown) => setDraftSettings((current) => ({ ...current, [group]: { ...(current[group] as Record<string, unknown> || {}), [key]: value } }))
  const updateFlag = (key: string, value: boolean) => setDraftFlags((current) => ({ ...current, [key]: value }))
  const importEntries = useMemo(() => [
    ...entriesForGroup(draftSettings.import),
    ...entriesForGroup(draftSettings.security).map((entry) => ({ ...entry, key: `security.${entry.key}` })),
  ], [draftSettings.import, draftSettings.security])

  return <section className="skills-center-panel skills-settings-workbench" aria-labelledby="skills-settings-workbench-title">
    <div className="skills-center-panel-head"><div><div className="skills-eyebrow"><SlidersHorizontal size={14} aria-hidden="true" /> Control Plane</div><h2 id="skills-settings-workbench-title">系统设置</h2><p>按 Runtime、导入和安全、Artifacts、Feature Flags 管理 Package Runtime 的安全边界。</p></div><div className="skills-settings-actions"><button type="button" className="skills-button" onClick={() => void rollback()} disabled={busy}><RotateCcw size={14} aria-hidden="true" />回滚</button><button type="button" className="skills-button primary" onClick={() => void save()} disabled={busy}><Save size={14} aria-hidden="true" />保存设置</button></div></div>
    <div className="skills-message info"><Info size={14} aria-hidden="true" /><span>高风险开关默认关闭。关闭状态使用 neutral，开启状态使用 teal；设置变更会写入审计记录。</span></div>
    {message && <div className="skills-message" role="status"><CheckCircle2 size={14} aria-hidden="true" />{message}</div>}
    <div className="skills-settings-grid">
      <SettingsGroup title={GROUP_LABELS.runtime} description="Worker、队列和 Package 执行运行时参数。" entries={entriesForGroup(draftSettings.runtime)} onChange={(key, value) => updateSetting('runtime', key, value)} />
      <SettingsGroup title="Import & Security" description="导入来源、扫描策略和高风险 Capability 开关。" entries={importEntries} onChange={(key, value) => { const [group, actualKey] = key.includes('.') ? key.split('.', 2) : ['import', key]; updateSetting(group as SettingsGroupKey, actualKey, value) }} />
      <SettingsGroup title={GROUP_LABELS.artifacts} description="输出文件的保留、预览和导出策略。" entries={entriesForGroup(draftSettings.artifacts)} onChange={(key, value) => updateSetting('artifacts', key, value)} />
      <FeatureFlagsGroup flags={draftFlags} onChange={updateFlag} />
    </div>
    <div className="skills-settings-health" aria-label="Runtime health"><div><div className="skills-eyebrow"><Activity size={14} aria-hidden="true" /> Runtime health</div><strong>{healthLabel}</strong><p>{diagnostics ? `${diagnostics.queue.depth} 个队列任务 · ${diagnostics.worker.activeRuns ?? 0} 个活动 Run` : '正在检查 Runtime 状态。'}</p></div><span className={`skills-status ${healthTone}`}><HealthIcon tone={healthTone} />{healthLabel}</span></div>
  </section>
}

function SettingsGroup({ title, description, entries, onChange }: { title: string; description: string; entries: Array<{ key: string; value: unknown }>; onChange: (key: string, value: unknown) => void }) {
  return <section className="skills-settings-group" aria-labelledby={`settings-group-${slugify(title)}`}><header><h3 id={`settings-group-${slugify(title)}`}>{title}</h3><p>{description}</p></header>{entries.length === 0 ? <p className="skills-muted">暂无可编辑设置。</p> : <div className="skills-setting-list">{entries.map((entry) => <SettingControl key={entry.key} entry={entry} onChange={onChange} />)}</div>}</section>
}

function FeatureFlagsGroup({ flags, onChange }: { flags: SkillRuntimeFeatureFlags; onChange: (key: string, value: boolean) => void }) {
  const entries = Object.entries(flags).filter(([, value]) => typeof value === 'boolean')
  return <section className="skills-settings-group" aria-labelledby="settings-group-feature-flags"><header><h3 id="settings-group-feature-flags">Feature Flags</h3><p>现行 Runtime 能力可以通过 kill switch 快速关闭。</p></header>{entries.length === 0 ? <p className="skills-muted">暂无 Feature Flag。</p> : <div className="skills-setting-list">{entries.map(([key, value]) => <SettingControl key={key} entry={{ key, value }} onChange={(field, next) => onChange(field, Boolean(next))} />)}</div>}</section>
}

function SettingControl({ entry, onChange }: { entry: { key: string; value: unknown }; onChange: (key: string, value: unknown) => void }) {
  const isBoolean = typeof entry.value === 'boolean' || entry.value === undefined || entry.value === null
  const highRisk = isHighRiskKey(entry.key)
  const label = humanizeSettingKey(entry.key)
  if (isBoolean) return <label className={`skills-setting-row skills-toggle-row ${highRisk ? 'high-risk' : ''}`}><span><strong>{label}</strong><small>{highRisk ? '高风险能力，默认关闭' : '可由 Workspace 管理员调整'}</small></span><span className={`skills-toggle-control ${entry.value === true ? 'on' : 'off'}`}><input type="checkbox" checked={entry.value === true} onChange={(event) => onChange(entry.key, event.target.checked)} aria-label={label} /><span aria-hidden="true" /></span></label>
  if (typeof entry.value === 'number') return <label className="skills-setting-row"><span><strong>{label}</strong><small>Runtime 数值设置</small></span><input aria-label={label} type="number" value={entry.value} onChange={(event) => onChange(entry.key, Number(event.target.value))} /></label>
  return <label className="skills-setting-row"><span><strong>{label}</strong><small>Runtime 文本设置</small></span><input aria-label={label} value={String(entry.value ?? '')} onChange={(event) => onChange(entry.key, event.target.value)} /></label>
}

function entriesForGroup(group: unknown): Array<{ key: string; value: unknown }> {
  return group && typeof group === 'object'
    ? Object.entries(group as Record<string, unknown>).map(([key, value]) => ({ key, value }))
    : []
}
function humanizeSettingKey(key: string) { return key.split('.').map((part) => part.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')).join(' · ').replace(/^./, (value) => value.toUpperCase()) }
function isHighRiskKey(key: string) { return /(shell|script|command|exec|npx|github|network|external|publish|write|unsafe|allow)/i.test(key) }
function slugify(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-') }
function HealthIcon({ tone }: { tone: string }) { return tone === 'success' ? <ShieldCheck size={12} aria-hidden="true" /> : tone === 'warning' ? <Info size={12} aria-hidden="true" /> : <Activity size={12} aria-hidden="true" /> }
