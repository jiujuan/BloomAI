import React, { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { useSessionStore } from '@renderer/store'
import { cn } from '@renderer/utils'
import type { Session } from '@shared/schemas'
import { formatSessionRelativeTime } from './session-time'

export function normalizeSessionTitleInput(title: string): string {
  return title.trim()
}

export function canSaveSessionTitle(title: string): boolean {
  return normalizeSessionTitleInput(title).length > 0
}

export function SessionRow({ session, isActive, onSelect, onDeleted }: {
  session: Session
  isActive: boolean
  onSelect: () => void | Promise<void>
  onDeleted?: () => void
}) {
  const { deleteSession, updateSessionTitle } = useSessionStore()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState(session.title)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const saveTitle = async () => {
    const title = normalizeSessionTitleInput(draftTitle)
    if (!title) { setTitleError('标题不能为空'); return }
    setSaving(true); setTitleError(null)
    try {
      await updateSessionTitle(session.id, title)
      setEditOpen(false)
    } catch {
      setTitleError('标题保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    try {
      await deleteSession(session.id)
      setDeleteOpen(false)
      onDeleted?.()
    } catch {
      // The row stays visible if server-side deletion cannot be confirmed.
    }
  }

  return <>
    <div
      role="listitem"
      className={cn('session-item', isActive && 'active')}
      onClick={() => void onSelect()}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void onSelect() }
      }}
    >
      <div className="session-item-body"><div className="session-item-title" title={session.title}>{session.title}</div><div className="session-item-meta">{session.project_id && <span className="session-local-badge">本地</span>}<span>{formatSessionRelativeTime(session.updated_at)}</span></div></div>
      <div className="session-item-actions">
        <button className="session-item-action" onClick={(event) => { event.stopPropagation(); setDraftTitle(session.title); setTitleError(null); setEditOpen(true) }} title="修改标题" aria-label={`修改标题：${session.title}`}><Pencil size={12} /></button>
        <button className="session-item-action danger" onClick={(event) => { event.stopPropagation(); setDeleteOpen(true) }} title="删除会话" aria-label={`删除会话：${session.title}`}><Trash2 size={12} /></button>
      </div>
    </div>

    {deleteOpen && <div className="modal-overlay" onClick={() => setDeleteOpen(false)}>
      <div className="modal session-action-modal" role="dialog" aria-modal="true" aria-labelledby={`delete-session-${session.id}`} onClick={(event) => event.stopPropagation()}>
        <h2 className="modal-title" id={`delete-session-${session.id}`}>删除会话？</h2>
        <p className="session-modal-copy">是否删除「{session.title}」？该会话将从列表中移除。</p>
        <div className="modal-actions"><button className="btn-secondary" onClick={() => setDeleteOpen(false)}>否</button><button className="btn-danger-sm" onClick={() => void confirmDelete()}>是</button></div>
      </div>
    </div>}

    {editOpen && <div className="modal-overlay" onClick={() => !saving && setEditOpen(false)}>
      <div className="modal session-action-modal" role="dialog" aria-modal="true" aria-labelledby={`edit-session-${session.id}`} onClick={(event) => event.stopPropagation()}>
        <h2 className="modal-title" id={`edit-session-${session.id}`}>修改标题</h2>
        <label className="session-title-field"><span>标题</span><input value={draftTitle} autoFocus aria-invalid={!!titleError} className="session-title-input" onChange={(event) => { setDraftTitle(event.target.value); setTitleError(null) }} onKeyDown={(event) => { if (event.key === 'Enter') void saveTitle(); if (event.key === 'Escape' && !saving) setEditOpen(false) }} /></label>
        {titleError && <div className="session-title-error" role="alert">{titleError}</div>}
        <div className="modal-actions"><button className="btn-secondary" disabled={saving} onClick={() => setEditOpen(false)}>取消</button><button className="btn-primary" disabled={saving || !canSaveSessionTitle(draftTitle)} onClick={() => void saveTitle()}>{saving ? '保存中...' : '保存'}</button></div>
      </div>
    </div>}
  </>
}
