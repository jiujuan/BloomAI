import React, { useState } from 'react'
import { Plus, Trash2, Pencil, Image as ImageIcon } from 'lucide-react'
import { useImageStore } from '@renderer/store'
import { cn } from '@renderer/utils'

/** Left column: AI 画图 session list (new / switch / rename / delete). */
export function ImageSessionList() {
  const { sessions, activeSessionId, createSession, setActiveSession, deleteSession, renameSession } = useImageStore()
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const startEdit = (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation()
    setEditId(id)
    setDraft(title)
  }

  const commitEdit = async () => {
    if (editId && draft.trim()) await renameSession(editId, draft.trim())
    setEditId(null)
    setDraft('')
  }

  return (
    <div className="session-list-panel">
      <div className="session-list-top">
        <button className="session-new-chat" onClick={() => createSession()} title="新建画图">
          <Plus size={15} />
          <span>新建画图</span>
        </button>
      </div>

      <div className="session-list" role="list">
        {sessions.length === 0 && (
          <div className="session-empty">
            <p>还没有画图会话</p>
            <button className="btn-primary-sm" onClick={() => createSession()}>开始画图</button>
          </div>
        )}
        {sessions.map(s => (
          <div
            key={s.id}
            role="listitem"
            className={cn('session-item', activeSessionId === s.id && 'active')}
            onClick={() => setActiveSession(s.id)}
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && setActiveSession(s.id)}
          >
            <ImageIcon size={13} className="session-item-dot" />
            <div className="session-item-body">
              {editId === s.id ? (
                <input
                  className="session-title-input"
                  value={draft}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                  onChange={e => setDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitEdit()
                    if (e.key === 'Escape') { setEditId(null); setDraft('') }
                  }}
                />
              ) : (
                <div className="session-item-title">{s.title}</div>
              )}
            </div>
            <div className="session-item-actions">
              <button className="session-item-action" onClick={e => startEdit(e, s.id, s.title)} title="重命名">
                <Pencil size={12} />
              </button>
              <button className="session-item-action danger" onClick={e => { e.stopPropagation(); deleteSession(s.id) }} title="删除">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
