import React, { useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { useSessionStore, useChatStore, usePersonaStore } from '../../stores/index'
import { groupSessionsByDate, cn } from '../../lib/utils'

export function SessionList() {
  const { sessions, activeSessionId, setActiveSession, createSession, deleteSession } = useSessionStore()
  const { loadMessages } = useChatStore()
  const { activePersonaId } = usePersonaStore()
  const [query, setQuery] = useState('')

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

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await deleteSession(id)
  }

  return (
    <div className="session-list-panel">
      <div className="session-list-top">
        <div className="session-search">
          <Search size={13} className="session-search-icon" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search sessions…"
            className="session-search-input"
            aria-label="Search sessions"
          />
        </div>
        <button className="btn-icon" onClick={handleNew} title="New chat" aria-label="New chat">
          <Plus size={15} />
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
                <button
                  className="session-item-delete"
                  onClick={e => handleDelete(e, session.id)}
                  title="Delete session"
                  aria-label="Delete session"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
