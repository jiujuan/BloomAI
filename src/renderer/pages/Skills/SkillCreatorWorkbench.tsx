import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react'
import { useSkillRuntimeStore } from './skill-runtime.store'
import { getPublishedPackageId, getCreatorCapabilityRisk, normalizeSkillDraftContent } from './skill-runtime.types'
import type { CreatorPublishResult, DraftDto, DraftPreview, DraftValidation, SkillDraftContent } from './skill-runtime.types'
import { SkillCreatorEditor } from './SkillCreatorEditor'
import { SkillCreatorPreview } from './SkillCreatorPreview'
import { SkillCreatorValidationPanel } from './SkillCreatorValidationPanel'
import { SkillCreatorPublishDialog } from './SkillCreatorPublishDialog'

const emptyContent: SkillDraftContent = { runtimeKind: 'package', name: 'New Skill', slug: 'new-skill', version: '0.1.0', description: '', skillMd: '# New Skill\n', references: {}, assets: [], capabilities: [], visibility: 'private' }

type CreatorDraftEntryProps = { draftId: string | null; onCreated: () => void | Promise<void>; onPublished?: (result: CreatorPublishResult) => void | Promise<void> }

export { getCreatorCapabilityRisk, getPublishedPackageId }

export function canPublishCreatorDraft(validation: DraftValidation | null, preview: DraftPreview | null) {
  return Boolean(validation?.valid && preview?.validation.valid && preview.draft)
}

function isRevisionConflict(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'REVISION_CONFLICT')
}

export function SkillCreatorWorkbench({ draftId, onCreated, onPublished }: CreatorDraftEntryProps) {
  const runtime = useSkillRuntimeStore()
  const serverDraft = draftId ? runtime.drafts[draftId] : null
  const [content, setContent] = useState<SkillDraftContent | null>(serverDraft ? normalizeSkillDraftContent(serverDraft.content) : null)
  const [revision, setRevision] = useState(serverDraft?.revision || 0)
  const [validation, setValidation] = useState<DraftValidation | null>(null)
  const [preview, setPreview] = useState<DraftPreview | null>(null)
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setValidation(null)
    setPreview(null)
    setConflict(false)
    setMessage(null)
    if (!draftId) {
      setContent(null)
      setRevision(0)
      setDirty(false)
      return () => { active = false }
    }
    const existing = runtime.drafts[draftId]
    if (existing) {
      setContent(normalizeSkillDraftContent(existing.content))
      setRevision(existing.revision)
      setDirty(false)
      return () => { active = false }
    }
    setContent(null)
    void runtime.loadDraft(draftId).then((draft) => {
      if (!active) return
      setContent(normalizeSkillDraftContent(draft.content))
      setRevision(draft.revision)
      setDirty(false)
    }).catch(() => undefined)
    return () => { active = false }
  }, [draftId])

  useEffect(() => {
    if (!draftId || !content || !dirty) return
    const timer = window.setTimeout(async () => {
      try {
        const saved = await runtime.updateDraft(draftId, { expectedRevision: revision, patch: content })
        setRevision(saved.revision)
        setContent(normalizeSkillDraftContent(saved.content))
        setDirty(false)
        setConflict(false)
        setMessage('Autosave 已保存。')
      } catch (error) {
        if (isRevisionConflict(error)) {
          setConflict(true)
          setMessage('检测到 revision conflict；本地未提交内容已保留，请刷新 server truth 后再决定覆盖。')
          await runtime.refreshAfterConflict('draft', draftId).catch(() => undefined)
        }
      }
    }, 600)
    return () => window.clearTimeout(timer)
  }, [draftId, content, dirty, revision])

  const publishEnabled = runtime.capabilities?.creatorPublishEnabled === true
  const editorDisabled = !content || busy !== null || conflict
  const validationEvidence = useMemo(() => validation && preview ? { validation, preview } : null, [validation, preview])

  if (!draftId) return <section className="skills-center-panel skills-creator-entry" aria-labelledby="skills-creator-title"><div className="skills-eyebrow"><ShieldCheck size={14} /> Skills Creator</div><h2 id="skills-creator-title">Skills Creator</h2><p>创建一个由 server 管理 revision 的 Draft，编辑 metadata、SKILL.md、references/assets 和 capability 请求。</p><div className="skills-creator-runtime-summary"><strong>Package Runtime</strong><span>Creator Draft 只允许发布到当前 Package Runtime。</span></div><div className="skills-creator-flag">Publish feature flag: <strong>{publishEnabled ? 'enabled' : 'disabled'}</strong></div><button type="button" className="skills-button primary" onClick={() => void onCreated()}>新建 Draft</button></section>
  if (!content) return <section className="skills-center-panel" role="status"><LoaderCircle className="spin" size={16} />正在加载 Draft…</section>

  const updateContent = (next: SkillDraftContent) => {
    setContent(normalizeSkillDraftContent(next))
    setDirty(true)
    setValidation(null)
    setPreview(null)
    setMessage(null)
  }
  const validate = async () => {
    setBusy('validate'); setMessage(null)
    try { setValidation(await runtime.validateDraft(draftId)); setPreview(null) } catch { /* store exposes error */ } finally { setBusy(null) }
  }
  const previewDraft = async () => {
    if (!validation?.valid) { setMessage('请先通过 Validate，再生成 Preview。'); return }
    setBusy('preview'); setMessage(null)
    try { setPreview(await runtime.previewDraft(draftId)) } catch { /* store exposes error */ } finally { setBusy(null) }
  }
  const discard = async () => {
    if (typeof window !== 'undefined' && !window.confirm('确认丢弃 Draft？已保存的草稿会标记为 discarded，未发布版本和审计记录不会被伪造删除。')) return
    setBusy('discard')
    try { await runtime.discardDraft(draftId); await onCreated() } catch { /* store exposes error */ } finally { setBusy(null) }
  }
  const publish = async (input: { enable?: boolean }) => {
    if (!canPublishCreatorDraft(validation, preview)) {
      setMessage('Validation error 或 Preview evidence 未通过，不能发布。')
      return
    }
    setBusy('publish')
    try {
      const result = await runtime.publishDraft(draftId, input)
      setPublishOpen(false)
      const packageId = getPublishedPackageId(result)
      setMessage(packageId ? `Publish 成功：Package ${packageId} · Version ${result.versionId || '—'} · Installation ${result.installationId || '—'}` : 'Publish 已提交，但 server 未返回 Package relation。')
      await onPublished?.(result)
    } catch { /* store exposes error */ } finally { setBusy(null) }
  }
  const refreshServerTruth = async () => {
    setBusy('refresh')
    try {
      const fresh = await runtime.loadDraft(draftId)
      setContent(normalizeSkillDraftContent(fresh.content))
      setRevision(fresh.revision)
      setDirty(false)
      setConflict(false)
      setMessage('已刷新 server truth，本地未提交变更已被明确丢弃。')
    } catch { /* store exposes error */ } finally { setBusy(null) }
  }

  return <section className="skills-creator-workbench" aria-labelledby="creator-workbench-title">
    <header className="skills-center-panel-head"><div><div className="skills-eyebrow"><Save size={14} /> Skills Creator</div><h2 id="creator-workbench-title">编辑 Draft · {content.name || 'Untitled'}</h2><p>revision {revision} · {dirty ? '有未保存变更' : 'server truth 已同步'}</p></div><span className={'skills-status ' + (conflict ? 'danger' : dirty ? 'warning' : 'success')}>{conflict ? 'revision conflict' : dirty ? 'autosave pending' : 'saved'}</span></header>
    {message && <div className="skills-message info">{message}</div>}
    {conflict && <div className="skills-message warning"><AlertTriangle size={14} />Revision conflict 不会静默覆盖服务端；本地编辑仍保留。<button type="button" className="skills-text-button" onClick={() => void refreshServerTruth()}><RefreshCw size={13} />刷新 server truth</button></div>}
    <div className="skills-creator-layout"><SkillCreatorEditor content={content} disabled={editorDisabled} onChange={updateContent} /><div className="skills-creator-side"><SkillCreatorValidationPanel validation={validation} /><SkillCreatorPreview content={content} preview={preview} /></div></div>
    <footer className="skills-modal-foot skills-creator-actions"><button type="button" className="skills-button secondary" disabled={busy !== null} onClick={() => void validate()}>{busy === 'validate' ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />}Validate</button><button type="button" className="skills-button secondary" disabled={busy !== null || !validation?.valid} onClick={() => void previewDraft()}>{busy === 'preview' ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}Preview</button><button type="button" className="skills-button primary" disabled={!publishEnabled || busy !== null || !canPublishCreatorDraft(validation, preview)} onClick={() => setPublishOpen(true)}>Publish</button><button type="button" className="skills-button danger" disabled={busy !== null} onClick={() => void discard()}><Trash2 size={14} />Discard</button></footer>
    {publishOpen && <SkillCreatorPublishDialog preview={preview} validation={validationEvidence?.validation || validation} enabled={publishEnabled} busy={busy === 'publish'} onClose={() => setPublishOpen(false)} onPublish={publish} />}
  </section>
}
