import React, { useState } from 'react'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useSessionStore, useChatStore, usePersonaStore } from '@renderer/store'
import { groupSessionsByDate, cn } from '@renderer/utils'
import type { Session } from '@shared/schemas'

export function normalizeSessionTitleInput(title: string): string {
  return title.trim()
}

export function canSaveSessionTitle(title: string): boolean {
  return normalizeSessionTitleInput(title).length > 0
}

export function SessionList() {
  const { sessions, activeSessionId, setActiveSession, createSession, deleteSession, updateSessionTitle } = useSessionStore()
  const { loadMessages } = useChatStore()
  const { activePersonaId } = usePersonaStore()
  const [query, setQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null)
  const [editTarget, setEditTarget] = useState<Session | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [savingTitle, setSavingTitle] = useState(false)

  const filtered = query
    ? sessions.filter(s => s.title.toLowerCase().includes(query.toLowerCase()))
    : sessions
  const groups = groupSessionsByDate(filtered)

  const handleNew = async () => {
    const s = await createSession({ persona_id: activePersonaId || undefined })
    await loadMessages(s.id)
  }

  const handleSelect = async (id: string) => {
    setActiveSession(id)
    await loadMessages(id)
  }

  const openDeleteDialog = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation()
    setDeleteTarget(session)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    await deleteSession(deleteTarget.id)
    setDeleteTarget(null)
  }

  const openEditDialog = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation()
    setEditTarget(session)
    setDraftTitle(session.title)
    setTitleError(null)
  }

  const closeEditDialog = () => {
    if (savingTitle) return
    setEditTarget(null)
    setDraftTitle('')
    setTitleError(null)
  }

  const saveTitle = async () => {
    if (!editTarget) return
    const nextTitle = normalizeSessionTitleInput(draftTitle)
    if (!canSaveSessionTitle(nextTitle)) {
      setTitleError('标题不能为空')
      return
    }

    setSavingTitle(true)
    setTitleError(null)
    try {
      await updateSessionTitle(editTarget.id, nextTitle)
      setEditTarget(null)
      setDraftTitle('')
      setTitleError(null)
    } catch {
      setTitleError('标题保存失败，请重试')
    } finally {
      setSavingTitle(false)
    }
  }

  return (
    <div className="session-list-panel">
      <div className="session-list-top">
        <div className="session-search">
          <Search size={13} className="session-search-icon" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search sessions..."
            className="session-search-input"
            aria-label="Search sessions"
          />
        </div>
        <button className="session-new-chat" onClick={handleNew} title="New chat" aria-label="New chat">
          <Plus size={15} />
          <span>New chat</span>
        </button>
      </div>

      <div className="session-list" role="list">
        {Object.entries(groups).length === 0 && (
          <div className="session-empty">
            <p>No sessions yet</p>
            <button className="btn-primary-sm" onClick={handleNew}>Start chatting</button>
          </div>
        )}
        {Object.entries(groups).map(([label, items]) => (
          <div key={label} className="session-group">
            <div className="session-group-label">{label}</div>
            {items.map(session => (
              <div
                key={session.id}
                role="listitem"
                className={cn('session-item', activeSessionId === session.id && 'active')}
                onClick={() => handleSelect(session.id)}
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && handleSelect(session.id)}
              >
                <div className="session-item-dot" />
                <div className="session-item-body">
                  <div className="session-item-title">{session.title}</div>
                </div>
                <div className="session-item-actions">
                  <button
                    className="session-item-action"
                    onClick={e => openEditDialog(e, session)}
                    title="修改标题"
                    aria-label={`修改标题：${session.title}`}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    className="session-item-action danger"
                    onClick={e => openDeleteDialog(e, session)}
                    title="删除会话"
                    aria-label={`删除会话：${session.title}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal session-action-modal" role="dialog" aria-modal="true" aria-labelledby="delete-session-title" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title" id="delete-session-title">删除会话？</h2>
            <p className="session-modal-copy">
              是否删除「{deleteTarget.title}」？该会话将从列表中移除。
            </p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>否</button>
              <button className="btn-danger-sm" onClick={confirmDelete}>是</button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <div className="modal-overlay" onClick={closeEditDialog}>
          <div className="modal session-action-modal" role="dialog" aria-modal="true" aria-labelledby="edit-session-title" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title" id="edit-session-title">修改标题</h2>
            <label className="session-title-field">
              <span>标题</span>
              <input
                value={draftTitle}
                onChange={e => {
                  setDraftTitle(e.target.value)
                  setTitleError(null)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveTitle()
                  if (e.key === 'Escape') closeEditDialog()
                }}
                className="session-title-input"
                autoFocus
                aria-invalid={!!titleError}
              />
            </label>
            {titleError && <div className="session-title-error" role="alert">{titleError}</div>}
            <div className="modal-actions">
              <button className="btn-secondary" onClick={closeEditDialog} disabled={savingTitle}>取消</button>
              <button className="btn-primary" onClick={saveTitle} disabled={!canSaveSessionTitle(draftTitle) || savingTitle}>
                {savingTitle ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
