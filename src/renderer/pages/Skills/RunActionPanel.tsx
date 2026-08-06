import React, { useState } from 'react'
import { Ban, CheckCircle2, LoaderCircle, RotateCcw, Send, XCircle } from 'lucide-react'
import type { RunAction, RunActionType, RunInputField, RunRequiredAction, SkillRun } from './skill-runtime.types'

export function RunActionPanel({ run, onAction, busy = false }: { run: SkillRun; onAction: (action: RunAction) => void | Promise<void>; busy?: boolean }) {
  const requiredAction = run.requiredAction ?? {}
  const supported = run.supportedActions?.length ? run.supportedActions : fallbackActions(run, requiredAction)
  const [reason, setReason] = useState('')
  const fields = Array.isArray(requiredAction.fields) ? requiredAction.fields : []
  const [values, setValues] = useState<Record<string, unknown>>({})
  const action = (type: RunActionType, extra: Partial<RunAction> = {}) => onAction({ type, expectedRevision: run.revision, idempotencyKey: makeIdempotencyKey(type), ...extra } as RunAction)
  const submitInput = () => action('submit_input', { input: values })
  return <section className="skills-detail-section skills-run-actions" aria-labelledby="run-action-panel-title"><div className="skills-detail-heading"><h3 id="run-action-panel-title">下一步操作</h3><span className="skills-muted">revision {run.revision}</span></div>
    {run.status === 'waiting_approval' && <p className="skills-muted">服务端要求审批后才会继续。未授权时不会执行能力调用。</p>}
    {run.status === 'waiting_input' && fields.length > 0 && <div className="skills-input-form">{fields.map((field) => <InputField key={field.name} field={field} value={values[field.name]} onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} />)}</div>}
    <div className="skills-action-row">{supported.map((type) => <ActionButton key={type} type={type} disabled={busy} expectedRevision={run.revision} onClick={() => type === 'submit_input' ? submitInput() : type === 'reject' ? action(type, { reason: reason.trim() || undefined }) : action(type)} />)}</div>
    {supported.includes('reject') && <label className="skills-field"><span>拒绝原因（可选）</span><textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="说明拒绝原因，最多 500 字" /></label>}
  </section>
}

function ActionButton({ type, disabled, expectedRevision, onClick }: { type: RunActionType; disabled: boolean; expectedRevision: number; onClick: () => void }) {
  const icon = type === 'approve' || type === 'confirm' ? <CheckCircle2 size={14} /> : type === 'reject' ? <XCircle size={14} /> : type === 'retry' ? <RotateCcw size={14} /> : type === 'submit_input' ? <Send size={14} /> : type === 'cancel' ? <Ban size={14} /> : <LoaderCircle size={14} />
  const label = ({ approve: '批准', confirm: '确认继续', reject: '拒绝', retry: '重试', submit_input: '提交输入', cancel: '取消 Run', resume: '恢复', modify: '修改输入' } as Record<string, string>)[type] ?? type
  return <button type="button" className={'skills-button ' + (type === 'reject' || type === 'cancel' ? 'danger' : type === 'approve' || type === 'confirm' || type === 'submit_input' ? 'primary' : 'secondary')} disabled={disabled} data-run-action={type} data-expected-revision={expectedRevision} onClick={onClick}>{icon}{label}</button>
}

function InputField({ field, value, onChange }: { field: RunInputField; value: unknown; onChange: (value: unknown) => void }) {
  const common = { name: field.name, required: field.required, placeholder: field.placeholder, value: value == null ? '' : String(value), onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange(field.type === 'number' ? Number(event.target.value) : field.type === 'boolean' ? event.target.value === 'true' : event.target.value) }
  return <label className="skills-field"><span>{field.label}{field.required ? ' *' : ''}</span>{field.type === 'textarea' ? <textarea {...common} /> : field.type === 'select' ? <select {...common}><option value="">请选择</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === 'boolean' ? <select {...common}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select> : <input {...common} type={field.secret ? 'password' : field.type === 'url' ? 'url' : field.type === 'number' ? 'number' : 'text'} autoComplete={field.secret ? 'off' : undefined} />}</label>
}

function fallbackActions(run: SkillRun, requiredAction: RunRequiredAction): RunActionType[] {
  if (requiredAction.type === 'approval' || run.status === 'waiting_approval') return ['approve', 'reject', 'cancel']
  if (requiredAction.type === 'input' || run.status === 'waiting_input') return ['submit_input', 'cancel']
  if (['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(run.status)) return []
  return ['cancel']
}

function makeIdempotencyKey(operation: string) { return `${operation}-${Date.now()}-${Math.random().toString(36).slice(2)}` }
