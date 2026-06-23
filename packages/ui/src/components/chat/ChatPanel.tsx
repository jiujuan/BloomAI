import React, { useEffect, useState, useRef } from 'react'
import { ChevronDown, MoreHorizontal, Search, Download } from 'lucide-react'
import { SessionList } from './SessionList'
import { Timeline } from './Timeline'
import { InputBar } from './InputBar'
import { ContextPills } from './ContextPills'
import { useSessionStore, useChatStore, usePersonaStore, useSettingsStore } from '../../stores/index'
import { AVAILABLE_MODELS, MODEL_LABELS, PERSONA_COLORS, cn } from '../../lib/utils'
import type { Persona } from '../../lib/schemas/index'

function ModelDropdown({ model, onSelect }: { model: string; onSelect: (m: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="model-dropdown-wrap" ref={ref}>
      <button className="model-pill" onClick={() => setOpen(!open)} aria-haspopup="listbox">
        <span className="model-dot green" />
        <span>{MODEL_LABELS[model] || model}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="model-dropdown" role="listbox" aria-label="Select model">
          <div className="model-dropdown-header">Model</div>
          {AVAILABLE_MODELS.map(m => (
            <button
              key={m.id}
              className={cn('model-option', model === m.id && 'selected')}
              role="option"
              aria-selected={model === m.id}
              onClick={() => { onSelect(m.id); setOpen(false) }}
            >
              <span className="model-dot green" />
              <div className="model-option-info">
                <span className="model-option-name">{m.label}</span>
                <span className="model-option-sub">{m.provider}{m.badge ? ` · ${m.badge}` : ''}</span>
              </div>
              {model === m.id && <span className="model-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PersonaPill({ personas, activeId, onSelect }: { personas: Persona[]; activeId: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = personas.find(p => p.id === activeId)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="persona-dropdown-wrap" ref={ref}>
      <button className="persona-pill" onClick={() => setOpen(!open)} aria-haspopup="listbox">
        <span className="persona-avatar" style={{ background: PERSONA_COLORS[active?.id || ''] || '#888' }}>
          {(active?.name || 'A')[0]}
        </span>
        <span>{active?.name || 'Default'}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="persona-dropdown" role="listbox" aria-label="Select persona">
          {personas.map(p => (
            <button
              key={p.id}
              className={cn('persona-option', activeId === p.id && 'selected')}
              role="option"
              aria-selected={activeId === p.id}
              onClick={() => { onSelect(p.id); setOpen(false) }}
            >
              <span className="persona-option-avatar" style={{ background: PERSONA_COLORS[p.id] || '#888' }}>
                {p.name[0]}
              </span>
              <span className="persona-option-name">{p.name}</span>
              {activeId === p.id && <span className="persona-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ChatPanel() {
  const { sessions, activeSessionId, updateSessionTitle } = useSessionStore()
  const { messagesBySession, streamingText, isStreaming, streamError, sendMessage, loadMessages } = useChatStore()
  const { personas, activePersonaId, setActivePersona } = usePersonaStore()
  const { settings } = useSettingsStore()
  const [context, setContext] = useState<{ activeApp?: string; clipboardContent?: string }>({})

  const session = sessions.find(s => s.id === activeSessionId)
  const messages = activeSessionId ? (messagesBySession[activeSessionId] || []) : []
  const model = session?.model || settings.model || 'claude-3-5-sonnet-20241022'

  const handleSend = (content: string) => {
    if (!activeSessionId) return
    sendMessage(activeSessionId, content, context)
  }

  const handleModelChange = async (newModel: string) => {
    if (!activeSessionId) return
    const { platform } = await import('../../lib/platform')
    await platform.updateSession(activeSessionId, { model: newModel })
    const { useSessionStore: ss } = await import('../../stores/index')
    await ss.getState().loadSessions()
  }

  const handlePersonaChange = async (personaId: string) => {
    setActivePersona(personaId)
    if (!activeSessionId) return
    const { platform } = await import('../../lib/platform')
    await platform.updateSession(activeSessionId, { persona_id: personaId })
  }

  const tokenUsage = activeSessionId
    ? (useChatStore.getState().tokenUsage[activeSessionId])
    : null

  if (!activeSessionId || !session) {
    return (
      <div className="chat-panel empty-chat">
        <div className="empty-chat-content">
          <div className="empty-chat-icon">🌸</div>
          <h2>Welcome to BloomAI</h2>
          <p>Create a new session to get started</p>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">{session.title}</span>
        <PersonaPill personas={personas} activeId={activePersonaId} onSelect={handlePersonaChange} />
        <ModelDropdown model={model} onSelect={handleModelChange} />
        <button className="hdr-btn" title="Search in chat" aria-label="Search in chat" disabled>
          <Search size={15} />
        </button>
        <button className="hdr-btn" title="More options" aria-label="More options" disabled>
          <MoreHorizontal size={15} />
        </button>
      </div>

      <ContextPills onContextChange={setContext} />

      <Timeline
        messages={messages}
        isStreaming={isStreaming}
        streamingText={streamingText}
        streamError={streamError}
      />

      <div className="chat-footer">
        <InputBar onSend={handleSend} disabled={isStreaming} />
        {tokenUsage && (
          <div className="token-footer">
            <div className="token-bar-wrap">
              <div className="token-bar">
                <div
                  className="token-fill"
                  style={{ width: `${Math.min(100, ((tokenUsage.input + tokenUsage.output) / 8192) * 100)}%` }}
                />
              </div>
              <span className="token-text">
                {(tokenUsage.input + tokenUsage.output).toLocaleString()} / 8,192 · {MODEL_LABELS[model] || model}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
