import React, { useMemo, useRef, useState, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2, Send, Check, X, Search } from 'lucide-react'
import { API_BASE } from '@shared/constants'
import { useSessionStore, useSettingsStore } from '@renderer/store'
import { cn } from '@renderer/utils'

type ChatMode = 'chat' | 'plan' | 'deep'
const DEFAULT_MODEL = 'agnes-2.0-flash'

/**
 * P0b: minimal AI SDK UI chat panel.
 * Talks directly to the Mastra-backed Hono endpoint (POST /api/v1/chat) via useChat.
 * Renders message.parts (text / reasoning / tool-*) — no bloom-response-v1 contract.
 */
export function ChatPanelMastra() {
  const { sessions, activeSessionId } = useSessionStore()
  const { settings } = useSettingsStore()
  const session = sessions.find((s) => s.id === activeSessionId)

  const [mode, setMode] = useState<ChatMode>('chat')
  const [input, setInput] = useState('')
  const model = session?.model || settings.model || DEFAULT_MODEL
  const modeRef = useRef(mode)
  const modelRef = useRef(model)
  modeRef.current = mode
  modelRef.current = model

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_BASE}/chat`,
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, sessionId: activeSessionId },
          headers: {
            'x-bloom-mode': modeRef.current,
            'x-bloom-model': modelRef.current,
            'x-bloom-session': activeSessionId || '',
          },
        }),
      }),
    [activeSessionId],
  )

  const { messages, sendMessage, status, stop, error } = useChat({ transport })
  const isStreaming = status === 'submitted' || status === 'streaming'

  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, status])

  const handleSend = () => {
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    void sendMessage({ text })
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">{session?.title || 'Chat'}</span>
        <span className="model-pill"><span className="model-dot green" />{model}</span>
        <div className="mode-switch" role="tablist" aria-label="Chat mode">
          {(['chat', 'plan', 'deep'] as ChatMode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={cn('mode-tab', mode === m && 'active')}
              onClick={() => setMode(m)}
            >
              {m === 'chat' ? '对话' : m === 'plan' ? '计划' : '深思'}
            </button>
          ))}
        </div>
      </div>

      <div className="timeline" role="log" aria-live="polite">
        {messages.length === 0 && !isStreaming && (
          <div className="timeline-empty">
            <h2 className="timeline-empty-title">BloomAI (Mastra + AI SDK UI)</h2>
            <p className="timeline-empty-desc">Ask anything — streamed directly from the Mastra agent.</p>
          </div>
        )}

        {messages.map((m) => (
          <MessageView key={m.id} role={m.role} parts={(m as any).parts} />
        ))}

        {error && (
          <div className="timeline-error-block" role="alert">
            <div className="timeline-error-title">请求失败</div>
            <div className="timeline-error-message">{error.message}</div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="chat-footer">
        <div className="input-bar">
          <textarea
            className="input-textarea"
            value={input}
            placeholder="给 BloomAI 发消息…"
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          {isStreaming ? (
            <button className="send-btn" onClick={() => stop()} title="停止">
              <Loader2 size={16} className="spin" />
            </button>
          ) : (
            <button className="send-btn" onClick={handleSend} disabled={!input.trim()} title="发送">
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function MessageView({ role, parts }: { role: string; parts: any[] }) {
  if (role === 'user') {
    const text = (parts || []).filter((p) => p.type === 'text').map((p) => p.text).join('')
    return (
      <div className="message-bubble user">
        <div className="message-content">{text}</div>
      </div>
    )
  }

  return (
    <div className="message-bubble assistant">
      <div className="message-content">
        {(parts || []).map((part, i) => (
          <PartView key={i} part={part} />
        ))}
      </div>
    </div>
  )
}

function PartView({ part }: { part: any }) {
  if (part.type === 'text') {
    return (
      <div className="markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text || ''}</ReactMarkdown>
      </div>
    )
  }

  if (part.type === 'reasoning') {
    return (
      <div className="reasoning-block" data-role="reasoning">
        <div className="reasoning-label">思考</div>
        <div className="reasoning-text">{part.text}</div>
      </div>
    )
  }

  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    return <ToolPart part={part} />
  }

  return null
}

function ToolPart({ part }: { part: any }) {
  const name = String(part.type).slice('tool-'.length)
  const state: string = part.state || 'input-available'
  const running = state === 'input-streaming' || state === 'input-available'
  const failed = state === 'output-error'
  const query = part.input?.query
  const resultCount = Array.isArray(part.output?.results) ? part.output.results.length : undefined

  return (
    <div className={cn('tool-call-group-card', running ? 'running' : failed ? 'error' : 'success')}>
      <div className="tcg-head">
        <span className="tcg-icon"><Search size={12} /></span>
        <span className="tcg-name">{name}</span>
        <span className={cn('tcg-status', running ? 'running' : failed ? 'error' : 'success')}>
          {running ? <Loader2 size={11} className="spin" /> : failed ? <X size={11} /> : <Check size={11} />}
          {running ? ' Running' : failed ? ' Failed' : ' Done'}
        </span>
      </div>
      <div className="tcg-body">
        {query && <div className="tcg-call-row"><span className="tcg-call-main">query: {String(query)}</span></div>}
        {resultCount !== undefined && <div className="tcg-call-row"><span className="tcg-call-summary">{resultCount} results</span></div>}
        {failed && part.errorText && <div className="tcg-call-row"><span className="tcg-call-error">{part.errorText}</span></div>}
      </div>
    </div>
  )
}
