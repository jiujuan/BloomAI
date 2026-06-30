import React, { useMemo, useRef, useState, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Loader2, Send, ChevronDown, Check } from 'lucide-react'
import { API_BASE } from '@shared/constants'
import { platform } from '@renderer/api'
import { useSessionStore, useSettingsStore, useLlmStore } from '@renderer/store'
import { cn } from '@renderer/utils'
import { AssistantMarkdown } from './parts/AssistantMarkdown'
import { ReasoningPart } from './parts/ReasoningPart'
import { ToolGroupCard } from './parts/ToolGroupCard'
import { WorkflowSteps } from './parts/WorkflowSteps'
import { ApprovalCard, toApprovalRequest } from './parts/ApprovalCard'
import { isToolPart, toToolCallView, type ToolCallView } from './parts/tool-part'

type ChatMode = 'chat' | 'plan' | 'deep'
type TeamTab = '' | 'research' | 'writing' | 'coding'
const DEFAULT_MODEL = 'agnes-2.0-flash'
const MODE_LABEL: Record<ChatMode, string> = { chat: '对话', plan: '计划', deep: '深思' }
const TEAM_TABS: { id: TeamTab; label: string }[] = [
  { id: '', label: '通用' },
  { id: 'research', label: '研究' },
  { id: 'writing', label: '写作' },
  { id: 'coding', label: '编码' },
]

/**
 * Chat panel on Mastra + AI SDK UI. Renders message.parts (text / reasoning / tool-*)
 * with rich tool cards; no bloom-response-v1 contract. mode/model travel as headers.
 */
export function ChatPanelMastra() {
  const { sessions, activeSessionId } = useSessionStore()
  const { settings } = useSettingsStore()
  const { textModels, loadTextModels } = useLlmStore()
  const session = sessions.find((s) => s.id === activeSessionId)

  const [mode, setMode] = useState<ChatMode>('chat')
  const [team, setTeam] = useState<TeamTab>('')
  const [input, setInput] = useState('')
  const [modelOverride, setModelOverride] = useState<string | null>(null)
  const model = modelOverride || session?.model || settings.model || DEFAULT_MODEL
  const modeRef = useRef(mode)
  const modelRef = useRef(model)
  const teamRef = useRef(team)
  modeRef.current = mode
  modelRef.current = model
  teamRef.current = team

  useEffect(() => {
    loadTextModels()
  }, [loadTextModels])

  // Reset per-session model override when switching sessions.
  useEffect(() => {
    setModelOverride(null)
  }, [activeSessionId])

  const handleModelChange = (next: string) => {
    setModelOverride(next)
    if (activeSessionId) void platform.updateSession(activeSessionId, { model: next }).catch(() => {})
  }

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
            'x-bloom-agent': teamRef.current,
          },
        }),
      }),
    [activeSessionId],
  )

  const { messages, sendMessage, setMessages, status, stop, error, addToolApprovalResponse } = useChat({
    id: activeSessionId || undefined,
    transport,
  })
  const isStreaming = status === 'submitted' || status === 'streaming'
  const waitingForAssistant = isStreaming && messages[messages.length - 1]?.role === 'user'

  // Tracks decided approvals (id -> approved) so the card shows the outcome after a click.
  const [decidedApprovals, setDecidedApprovals] = useState<Record<string, boolean>>({})
  const handleDecide = (approvalId: string, approved: boolean) => {
    setDecidedApprovals((prev) => ({ ...prev, [approvalId]: approved }))
    addToolApprovalResponse({ id: approvalId, approved })
  }

  // Load persisted history when the active session changes (assistant text is restored;
  // historical tool cards are not reconstructed). New turns are saved server-side in onFinish.
  useEffect(() => {
    let cancelled = false
    if (!activeSessionId) {
      setMessages([])
      return
    }
    platform
      .getMessages(activeSessionId)
      .then((rows: any[]) => {
        if (cancelled) return
        setMessages(
          (rows || [])
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ id: m.id, role: m.role, parts: [{ type: 'text', text: m.content || '' }] })) as any,
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeSessionId, setMessages])

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
        <ModelMenu model={model} models={textModels} onSelect={handleModelChange} />
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
          <MessageView
            key={m.id}
            role={m.role}
            parts={(m as any).parts || []}
            decidedApprovals={decidedApprovals}
            onDecide={handleDecide}
          />
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
          <div className="team-tabs" role="tablist" aria-label="Agent">
            {TEAM_TABS.map((t) => (
              <button
                key={t.id || 'general'}
                role="tab"
                aria-selected={team === t.id}
                className={cn('team-tab', team === t.id && 'active')}
                onClick={() => setTeam(t.id)}
                title={t.id === 'coding' ? '编码：可读写文件/执行命令，危险操作需你确认' : undefined}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ModelMenu({ model, models, onSelect }: { model: string; models: { id: string; label: string; providerId: string }[]; onSelect: (m: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const label = models.find((m) => m.id === model)?.label || model
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
        <span>{label}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="model-dropdown" role="listbox" aria-label="Select model">
          {models.length === 0 && <div className="model-dropdown-header">No models</div>}
          {models.map((m) => (
            <button
              key={m.id}
              role="option"
              aria-selected={model === m.id}
              className={cn('model-option', model === m.id && 'selected')}
              onClick={() => { onSelect(m.id); setOpen(false) }}
            >
              <span className="model-dot green" />
              <div className="model-option-info">
                <span className="model-option-name">{m.label}</span>
                <span className="model-option-sub">{m.providerId}</span>
              </div>
              {model === m.id && <Check size={12} className="model-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type ApprovalProps = {
  decidedApprovals: Record<string, boolean>
  onDecide: (approvalId: string, approved: boolean) => void
}

function MessageView({ role, parts, decidedApprovals, onDecide }: { role: string; parts: any[] } & ApprovalProps) {
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
        <div className="msg-bubble">{renderAssistantParts(parts, { decidedApprovals, onDecide })}</div>
      </div>
    </div>
  )
}

// Render assistant parts in order, collapsing consecutive same-tool calls into one group card.
function renderAssistantParts(parts: any[], approval: ApprovalProps): React.ReactNode[] {
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
    } else if (part.type === 'data-workflow' && part.data) {
      items.push(<WorkflowSteps key={`wf-${i}`} data={part.data} />)
    } else if (part.type === 'data-tool-call-approval') {
      const req = toApprovalRequest(part)
      if (req) {
        items.push(
          <ApprovalCard
            key={`ap-${i}`}
            request={req}
            decided={approval.decidedApprovals[req.approvalId]}
            onDecide={approval.onDecide}
          />,
        )
      }
    }
    i++
  }
  return items
}
