import React, { useMemo, useRef, useState, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Loader2, Send } from 'lucide-react'
import { API_BASE } from '@shared/constants'
import { useSessionStore, useSettingsStore } from '@renderer/store'
import { cn } from '@renderer/utils'
import { AssistantMarkdown } from './parts/AssistantMarkdown'
import { ReasoningPart } from './parts/ReasoningPart'
import { ToolGroupCard } from './parts/ToolGroupCard'
import { isToolPart, toToolCallView, type ToolCallView } from './parts/tool-part'

type ChatMode = 'chat' | 'plan' | 'deep'
const DEFAULT_MODEL = 'agnes-2.0-flash'
const MODE_LABEL: Record<ChatMode, string> = { chat: '对话', plan: '计划', deep: '深思' }

/**
 * Chat panel on Mastra + AI SDK UI. Renders message.parts (text / reasoning / tool-*)
 * with rich tool cards; no bloom-response-v1 contract. mode/model travel as headers.
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
  const waitingForAssistant = isStreaming && messages[messages.length - 1]?.role === 'user'

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
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="timeline" role="log" aria-live="polite">
        {messages.length === 0 && !isStreaming && (
          <div className="timeline-empty">
            <h2 className="timeline-empty-title">BloomAI</h2>
            <p className="timeline-empty-desc">Ask anything — streamed directly from the Mastra agent.</p>
          </div>
        )}

        {messages.map((m) => (
          <MessageView key={m.id} role={m.role} parts={(m as any).parts || []} />
        ))}

        {waitingForAssistant && (
          <div className="msg-group">
            <div className="msg-avatar">AI</div>
            <div className="msg-col">
              <div className="msg-bubble streaming">
                <div className="msg-waiting" role="status" aria-live="polite">
                  <Loader2 size={15} className="msg-waiting-spinner" aria-hidden="true" />
                  <span className="sr-only">正在思考</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="timeline-error-block" role="alert">
            <div className="timeline-error-title">请求失败</div>
            <div className="timeline-error-message">{error.message}</div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="chat-footer">
        <div className="input-area">
          <div className="input-row">
            <textarea
              className="input-box"
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
              <button className={cn('send-btn', !input.trim() && 'disabled')} onClick={handleSend} disabled={!input.trim()} title="发送">
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageView({ role, parts }: { role: string; parts: any[] }) {
  if (role === 'user') {
    const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('')
    return (
      <div className="msg-group user">
        <div className="msg-avatar user">You</div>
        <div className="msg-col">
          <div className="msg-bubble user"><p className="msg-text">{text}</p></div>
        </div>
      </div>
    )
  }

  return (
    <div className="msg-group">
      <div className="msg-avatar">AI</div>
      <div className="msg-col">
        <div className="msg-bubble">{renderAssistantParts(parts)}</div>
      </div>
    </div>
  )
}

// Render assistant parts in order, collapsing consecutive same-tool calls into one group card.
function renderAssistantParts(parts: any[]): React.ReactNode[] {
  const items: React.ReactNode[] = []
  let i = 0
  while (i < parts.length) {
    const part = parts[i]

    if (isToolPart(part)) {
      const first = toToolCallView(part)
      const group: ToolCallView[] = [first]
      let j = i + 1
      while (j < parts.length && isToolPart(parts[j]) && toToolCallView(parts[j]).name === first.name) {
        group.push(toToolCallView(parts[j]))
        j++
      }
      items.push(<ToolGroupCard key={`tool-${i}`} name={first.name} calls={group} />)
      i = j
      continue
    }

    if (part.type === 'reasoning') {
      items.push(<ReasoningPart key={`r-${i}`} text={part.text || ''} streaming={part.state === 'streaming'} />)
    } else if (part.type === 'text') {
      items.push(<AssistantMarkdown key={`t-${i}`} text={part.text || ''} streaming={part.state === 'streaming'} />)
    }
    i++
  }
  return items
}
