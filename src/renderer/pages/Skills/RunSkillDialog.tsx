import React, { useState } from 'react'
import { AlertTriangle, LoaderCircle, Play, X } from 'lucide-react'
import { useSkillRuntimeStore } from './skill-runtime.store'
import type { SkillVersion } from './skill-runtime.types'

export function RunSkillDialog({ version, onClose, onStarted }: { version: SkillVersion; onClose: () => void; onStarted: () => void }) {
  const { startRun } = useSkillRuntimeStore()
  const [input, setInput] = useState('{}')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const start = async () => {
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(input) as Record<string, unknown>; if (Array.isArray(parsed) || !parsed) throw new Error('') } catch { setError('输入必须是 JSON 对象。'); return }
    setBusy(true); setError(null)
    try { await startRun({ skillVersionId: version.id, input: parsed }); onStarted(); onClose() } catch (cause) { setError(cause instanceof Error ? cause.message : '无法创建运行。') } finally { setBusy(false) }
  }
  return <div className="skills-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="skills-modal skills-run-modal" role="dialog" aria-modal="true" aria-labelledby="run-skill-title" onMouseDown={(event) => event.stopPropagation()}><header className="skills-modal-head"><div><div className="skills-eyebrow"><Play size={14} />调试运行</div><h2 id="run-skill-title">运行 {version.version}</h2></div><button className="skills-icon-button" onClick={onClose} aria-label="关闭运行窗口"><X size={16} /></button></header><div className="skills-modal-body"><p className="skills-muted">此入口面向高级用户。输入会被运行时汇总记录，不会在事件中保留敏感数据。</p><label className="skills-field"><span>运行输入（JSON 对象）</span><textarea className="skills-code-input" value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} /></label>{error && <div className="skills-message error"><AlertTriangle size={15} />{error}</div>}</div><footer className="skills-modal-foot"><button className="skills-button secondary" onClick={onClose}>取消</button><button className="skills-button primary" onClick={start} disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />}开始运行</button></footer></section></div>
}
