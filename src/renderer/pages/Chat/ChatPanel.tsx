import React, { useEffect, useMemo, useState, useRef } from 'react'
import { Check, ChevronDown, MoreHorizontal, Search } from 'lucide-react'
import { SessionList } from './SessionList'
import { Timeline } from './Timeline'
import { InputBar } from './InputBar'
import type { LlmModelSummary } from '@renderer/api'
import { useSessionStore, useChatStore, usePersonaStore, useSettingsStore, useLlmStore } from '@renderer/store'
import { cn } from '@renderer/utils'
import { platform } from '@renderer/api'
import { AVAILABLE_MODELS, MODEL_LABELS, PERSONA_COLORS } from '@shared/constants'
import type { Persona } from '@shared/schemas'
import type { StreamingResponseState } from '@renderer/store/chat-response-reducer'

type ChatModelOption = {
  id: string
  label: string
  provider: string
  badge?: string
}

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  agnes: 'Agnes',
  deepseek: 'DeepSeek',
  ollama: 'Ollama',
}

const FALLBACK_CHAT_MODEL = 'claude-3-5-sonnet-20241022'

export function resolveDisplayedChatModel(sessionModel: string | undefined, settingsModel: string | undefined): string {
  if (sessionModel && sessionModel !== FALLBACK_CHAT_MODEL) return sessionModel
  return settingsModel || sessionModel || FALLBACK_CHAT_MODEL
}

export function getChatModelOptions(models: LlmModelSummary[]): ChatModelOption[] {
  if (!models.length) {
    return AVAILABLE_MODELS.map(model => ({
      id: model.id,
      label: model.label,
      provider: model.provider,
      badge: model.badge,
    }))
  }

  return models.map(model => ({
    id: model.id,
    label: model.label,
    provider: PROVIDER_NAMES[model.providerId] || model.providerId,
    badge: typeof model.capabilities.badge === 'string' ? model.capabilities.badge : undefined,
  }))
}

export async function persistChatModelSelection(sessionId: string | null, model: string) {
  if (!sessionId) return
  await platform.updateSession(sessionId, { model })
  await useSessionStore.getState().loadSessions()
}

export function selectStreamingResponseForSession(
  activeSessionId: string | null,
  streamingResponsesBySession: Record<string, StreamingResponseState | null>,
): StreamingResponseState | null {
  return activeSessionId ? (streamingResponsesBySession[activeSessionId] ?? null) : null
}

function getChatModelLabel(model: string, options: ChatModelOption[]) {
  return options.find(option => option.id === model)?.label || MODEL_LABELS[model] || model
}

function ModelDropdown({ model, models, onSelect }: { model: string; models: ChatModelOption[]; onSelect: (m: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const modelLabel = getChatModelLabel(model, models)

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
        <span>{modelLabel}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="model-dropdown" role="listbox" aria-label="Select model">
          <div className="model-dropdown-header">Model</div>
          {models.map(m => (
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
              {model === m.id && <Check size={12} className="model-check" />}
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
              {activeId === p.id && <Check size={12} className="persona-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ChatPanel() {
  const { sessions, activeSessionId, updateSessionTitle } = useSessionStore()
  const {
    messagesBySession,
    streamingText,
    isStreaming,
    streamError,
    sendMessage,
    loadMessages,
    toolCallsBySession,
    streamingResponsesBySession,
  } = useChatStore()
  const { personas, activePersonaId, setActivePersona } = usePersonaStore()
  const { settings } = useSettingsStore()
  const { textModels, loadTextModels } = useLlmStore()

  const session = sessions.find(s => s.id === activeSessionId)
  const messages = activeSessionId ? (messagesBySession[activeSessionId] || []) : []
  const toolCalls = activeSessionId ? (toolCallsBySession[activeSessionId] || []) : []
  const streamingResponse = selectStreamingResponseForSession(activeSessionId, streamingResponsesBySession)
  const model = resolveDisplayedChatModel(session?.model, settings.model)
  const modelOptions = useMemo(() => getChatModelOptions(textModels), [textModels])

  useEffect(() => {
    loadTextModels()
  }, [loadTextModels])

  const handleSend = (content: string) => {
    if (!activeSessionId) return
    sendMessage(activeSessionId, content)
  }

  const handleModelChange = async (newModel: string) => {
    await persistChatModelSelection(activeSessionId, newModel)
  }

  const handlePersonaChange = async (personaId: string) => {
    setActivePersona(personaId)
    if (!activeSessionId) return
    // platform already imported
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
        <ModelDropdown model={model} models={modelOptions} onSelect={handleModelChange} />
        <button className="hdr-btn" title="Search in chat" aria-label="Search in chat" disabled>
          <Search size={15} />
        </button>
        <button className="hdr-btn" title="More options" aria-label="More options" disabled>
          <MoreHorizontal size={15} />
        </button>
      </div>


      <Timeline
        messages={messages}
        isStreaming={isStreaming}
        streamingText={streamingText}
        streamError={streamError}
        toolCalls={toolCalls}
        streamingResponse={streamingResponse}
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
                {(tokenUsage.input + tokenUsage.output).toLocaleString()} / 8,192 · {getChatModelLabel(model, modelOptions)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
