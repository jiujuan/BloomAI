import React, { useMemo, useRef, useState, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Loader2, Send, ChevronDown, Check, Plus, X, MessageCircle, ListTodo, Brain, type LucideIcon } from 'lucide-react'
import { API_BASE } from '@shared/constants'
import type { WritingConfig } from '@shared/writing'
import { platform } from '@renderer/api'
import { useSessionStore, useSettingsStore, useLlmStore } from '@renderer/store'
import { cn } from '@renderer/utils'
import { AssistantMarkdown } from './parts/AssistantMarkdown'
import { ReasoningPart } from './parts/ReasoningPart'
import { ToolGroupCard } from './parts/ToolGroupCard'
import { WorkflowSteps } from './parts/WorkflowSteps'
import { ApprovalCard, toApprovalRequest } from './parts/ApprovalCard'
import { PlanCard, type PlanStatus } from './parts/PlanCard'
import { WriterParams, defaultWritingConfig } from './WriterParams'
import { assistantPlainText, CopyButton, SelectionMenu, LikedBadge, CopyToast, PasteMenu, useSelectionMenu } from './MessageActions'
import { isToolPart, toToolCallView, slimParts, type ToolCallView } from './parts/tool-part'
import { AttachmentChips, type ChipItem } from './parts/AttachmentChips'
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_SIZE, extOf, isAllowedExt, type Attachment } from '@shared/attachments'

// A composer chip plus the resolved server metadata once its upload finishes (`att`).
type ComposerAttachment = ChipItem & { att?: Attachment }

type ChatMode = 'chat' | 'plan' | 'deep'
type TeamTab = '' | 'research' | 'writing' | 'coding'
// One plan proposal in the current turn. Stable `id` keeps its card in a fixed position.
type PlanEntry = { id: number; query: string; tasks: string[]; status: PlanStatus }
const DEFAULT_MODEL = 'agnes-2.0-flash'
const MODE_LABEL: Record<ChatMode, string> = { chat: '对话', plan: '计划', deep: '深度思考' }
const MODE_ICON: Record<ChatMode, LucideIcon> = {
  chat: MessageCircle,
  plan: ListTodo,
  deep: Brain,
}
const MODE_ORDER: ChatMode[] = ['chat', 'plan', 'deep']
const TEAM_TABS: { id: Exclude<TeamTab, ''>; label: string }[] = [
  { id: 'research', label: '研究' },
  { id: 'writing', label: 'AI写作' },
  { id: 'coding', label: '编码' },
]

// Rebuild a stored message's UI parts. Assistant rows persist their full parts JSON; user rows
// and legacy/pre-parts rows fall back to a single text part. Never throws — bad JSON → text.
function restoreParts(m: { content?: string; parts?: string | null }): any[] {
  if (m.parts) {
    try {
      const parsed = JSON.parse(m.parts)
      if (Array.isArray(parsed) && parsed.length) return parsed
    } catch {
      /* fall through to text */
    }
  }
  return [{ type: 'text', text: m.content || '' }]
}

// True if the assistant parts contain anything worth showing. The AI SDK appends an empty
// assistant message the instant the stream opens (often with only a `step-start` part), so we
// can't rely on role alone to decide whether the model has actually started answering.
function hasRenderableContent(parts: any[]): boolean {
  return parts.some((p) => {
    if (!p) return false
    if (p.type === 'text' || p.type === 'reasoning') return !!(p.text && p.text.trim())
    if (p.type === 'data-workflow') return !!p.data
    if (p.type === 'data-plan') return true
    if (p.type === 'data-tool-call-approval') return true
    return isToolPart(p)
  })
}

// True if the assistant has produced actual answer content (text / reasoning / tool / approval).
// Excludes data-plan: the confirmed plan card streams in first, before the model does any real
// work, so on its own it must NOT suppress the "thinking" indicator.
function hasAnswerContent(parts: any[]): boolean {
  return parts.some((p) => {
    if (!p) return false
    if (p.type === 'text' || p.type === 'reasoning') return !!(p.text && p.text.trim())
    if (p.type === 'data-workflow') return !!p.data
    if (p.type === 'data-tool-call-approval') return true
    return isToolPart(p)
  })
}

// Animated "thinking" indicator shown while waiting for the assistant's first content.
function WaitingIndicator() {
  return (
    <div className="msg-waiting" role="status" aria-live="polite">
      <Loader2 size={15} className="msg-waiting-spinner" aria-hidden="true" />
      <span className="sr-only">正在思考</span>
    </div>
  )
}

// The server already maps failures to short, friendly messages (see stream-error.ts). This is a
// last-resort guard for transport-level errors that bypass it: never show a stack / long dump.
function friendlyError(error: { message?: string }): string {
  const msg = (error?.message || '').trim()
  if (!msg || msg.length > 120 || /\n\s*at\s|Error:|\{|\}|stack/i.test(msg)) {
    return '请求出错了，请稍后重试。'
  }
  return msg
}

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
  // AI Writer parameters (type + dropdowns). Kept in memory so toggling the 写作 tab off and
  // back on restores the last selection (same lifetime as `team`/`mode` — component-scoped).
  const [writing, setWriting] = useState<WritingConfig>(defaultWritingConfig)
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Composer attachments (chips shown above the textarea). Each holds its resolved server
  // metadata once uploaded; a ref mirrors them so the transport can read the latest at send time.
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const attachmentsRef = useRef<ComposerAttachment[]>([])
  attachmentsRef.current = attachments
  // Attachments for the CURRENT in-flight send. Set synchronously right before sendMessage and
  // read by the transport when it builds the request — decoupled from `attachments` state, whose
  // clear-on-send re-render would otherwise empty attachmentsRef before the async fetch fires.
  const sendAttachmentsRef = useRef<Attachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Latest attachment validation / upload error, shown as a red line in the composer.
  const [attachError, setAttachError] = useState<string | null>(null)
  // Custom right-click "粘贴" menu for the input (position in viewport coords, or null when closed).
  const [pasteMenu, setPasteMenu] = useState<{ x: number; y: number } | null>(null)
  const [modelOverride, setModelOverride] = useState<string | null>(null)
  // Plan mode proposals for the current turn, in chronological order. Each entry keeps a stable
  // id so a card never changes DOM position when its status flips (ready → discarded); the newest
  // active plan is always the last non-discarded entry. Only that one is executable.
  const [plans, setPlans] = useState<PlanEntry[]>([])
  const planIdRef = useRef(0)
  // Holds the confirmed tasks between 是 and the stream's onFinish, so the transport can send
  // them (in the request body) and onFinish can attach a persisted data-plan part to the answer.
  const planRef = useRef<string[] | null>(null)
  // Snapshot of the plan cards taken at confirm time (they're cleared from view on 是). If the
  // execution request fails, we restore them so nothing is lost — see useChat onError below.
  const lastPlanTurnRef = useRef<PlanEntry[] | null>(null)
  const model = modelOverride || session?.model || settings.model || DEFAULT_MODEL
  const modeRef = useRef(mode)
  const modelRef = useRef(model)
  const teamRef = useRef(team)
  const writingRef = useRef(writing)
  modeRef.current = mode
  modelRef.current = model
  teamRef.current = team
  writingRef.current = writing

  useEffect(() => {
    loadTextModels()
  }, [loadTextModels])

  // Reset per-session model override when switching sessions.
  useEffect(() => {
    setModelOverride(null)
    setPlans([])
    setAttachments([])
    planRef.current = null
    lastPlanTurnRef.current = null
  }, [activeSessionId])

  const handleModelChange = (next: string) => {
    setModelOverride(next)
    if (activeSessionId) void platform.updateSession(activeSessionId, { model: next }).catch(() => {})
  }

  // Mode and team are mutually exclusive on the server (a team tab overrides mode).
  // Keep the UI honest: picking plan/deep clears the team tab; picking a team tab
  // resets mode to the neutral 对话.
  const handleModeChange = (next: ChatMode) => {
    setMode(next)
    if (next !== 'chat') setTeam('')
  }

  const handleTeamToggle = (id: Exclude<TeamTab, ''>) => {
    const next: TeamTab = team === id ? '' : id
    setTeam(next)
    if (next) setMode('chat')
  }

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_BASE}/chat`,
        prepareSendMessagesRequest: ({ messages }) => ({
          // Confirmed plan tasks travel in the body (not a header) because they may contain
          // non-ASCII text, which HTTP header values can't safely carry. Same for the writer
          // config, whose values are Chinese — only sent when the 写作 tab is active.
          body: {
            messages,
            sessionId: activeSessionId,
            plan: planRef.current || undefined,
            writing: teamRef.current === 'writing' ? writingRef.current : undefined,
            // Resolved attachments (with server path) for this turn. Read from a dedicated ref set
            // at send time so a clear-on-send re-render can't empty it before the request is built.
            attachments: sendAttachmentsRef.current,
          },
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
    // Persist the finished assistant message with its full UI parts so tool/reasoning/workflow
    // cards survive reloads. Read live state to avoid stale closures across renders.
    onFinish: ({ message }) => {
      if (message.role !== 'assistant') return
      const sid = useSessionStore.getState().activeSessionId
      if (!sid) return
      // Plan execution finished: the confirmed plan streamed in as a data-plan part (server
      // side), so it's already in message.parts — just release the refs for the next turn.
      if (planRef.current) planRef.current = null
      lastPlanTurnRef.current = null
      const parts = ((message as any).parts || []) as any[]
      const content = parts.filter((p) => p?.type === 'text').map((p) => p.text || '').join('')
      void platform
        .saveAssistantMessage({ sessionId: sid, content, parts: slimParts(parts), model: modelRef.current })
        .catch(() => {})
    },
    // Execution failed (e.g. model API error). Restore the plan cards that were cleared on 是 so
    // the full turn — both drafts and the confirmed plan — stays visible above the error message.
    onError: () => {
      planRef.current = null
      if (lastPlanTurnRef.current) {
        setPlans(lastPlanTurnRef.current)
        lastPlanTurnRef.current = null
      }
    },
  })
  const isStreaming = status === 'submitted' || status === 'streaming'
  const waitingForAssistant = isStreaming && messages[messages.length - 1]?.role === 'user'

  // Tracks decided approvals (id -> approved) so the card shows the outcome after a click.
  const [decidedApprovals, setDecidedApprovals] = useState<Record<string, boolean>>({})
  const handleDecide = (approvalId: string, approved: boolean) => {
    setDecidedApprovals((prev) => ({ ...prev, [approvalId]: approved }))
    addToolApprovalResponse({ id: approvalId, approved })
  }

  // Load persisted history when the active session changes. Assistant rows restore their stored
  // UI parts (tool cards, reasoning, workflow steps); user rows and legacy rows fall back to text.
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
            .map((m) => ({ id: m.id, role: m.role, parts: restoreParts(m) })) as any,
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeSessionId, setMessages])

  const timelineRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const tl = timelineRef.current
    if (tl) tl.scrollTo({ top: tl.scrollHeight, behavior: 'smooth' })
  }, [messages.length, status, plans.length])

  // Right-click in the input → show our own "粘贴" menu instead of the native one.
  const handleInputContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setPasteMenu({ x: e.clientX, y: e.clientY })
  }

  // Read the clipboard and insert it at the caret (replacing any selection) in the input.
  const pasteIntoInput = async () => {
    setPasteMenu(null)
    let text = ''
    try {
      text = await navigator.clipboard.readText()
    } catch {
      text = ''
    }
    if (!text) return
    const el = inputRef.current
    if (!el) {
      setInput((prev) => prev + text)
      return
    }
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    setInput(el.value.slice(0, start) + text + el.value.slice(end))
    // Restore focus + caret after React re-renders with the new value.
    const caret = start + text.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  // Client-side validate + upload each chosen file. Rejections (type / oversize) surface as a red
  // line via setAttachError; valid files show an uploading chip that resolves to server metadata.
  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // allow re-selecting the same file later
    setAttachError(null)
    for (const file of files) {
      const ext = extOf(file.name)
      const localId = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`
      if (!isAllowedExt(ext)) {
        setAttachError(`「${file.name}」类型不支持（仅支持 MD/DOCX/PDF/TXT/CSV）`)
        continue
      }
      if (file.size > ATTACHMENT_MAX_SIZE) {
        setAttachError(`「${file.name}」超过 5MB 上传限制`)
        continue
      }
      setAttachments((prev) => [...prev, { id: localId, name: file.name, ext, size: file.size, status: 'uploading' }])
      platform
        .uploadAttachments([file])
        .then(([saved]) => {
          setAttachments((prev) => prev.map((a) => (a.id === localId ? { ...a, status: undefined, error: undefined, att: saved } : a)))
        })
        .catch((err) => {
          // Drop the failed chip and report the reason as a red line rather than a stuck chip.
          setAttachments((prev) => prev.filter((a) => a.id !== localId))
          setAttachError(`「${file.name}」上传失败：${err?.message || '未知错误'}`)
        })
    }
  }

  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id))

  // Build the user message's UI parts: the typed text plus a `data-attachments` part carrying the
  // ready attachments, so the chips render on the sent bubble immediately (not only after reload).
  const buildUserParts = (text: string): any[] => {
    const files = attachmentsRef.current
      .filter((a) => a.att)
      .map((a) => ({ id: a.att!.id, name: a.att!.name, ext: a.att!.ext, size: a.att!.size }))
    const parts: any[] = []
    if (text) parts.push({ type: 'text', text })
    if (files.length) parts.push({ type: 'data-attachments', data: { files } })
    return parts
  }

  const uploading = attachments.some((a) => a.status === 'uploading')
  const readyAttachments = attachments.filter((a) => a.att)
  const canSend = (!!input.trim() || readyAttachments.length > 0) && !uploading

  const handleSend = () => {
    const text = input.trim()
    if (isStreaming || uploading) return
    if (!text && readyAttachments.length === 0) return
    // Plan mode: don't answer yet — propose a task list and wait for the user to confirm.
    // If a proposal is already pending, a new question discards it in place (kept visible as
    // "已丢弃", position unchanged) and proposes afresh below — only the latest plan is executable.
    // A plan needs a question; attachments (if any) ride along when the plan is executed.
    if (mode === 'plan') {
      if (!text) return
      const active = plans.find((p) => p.status === 'proposing' || p.status === 'ready')
      if (active && active.status !== 'ready') return // still generating; let it finish first
      setInput('')
      maybeSetTitleFromFirstMessage(text)
      const id = ++planIdRef.current
      setPlans((prev) => [
        ...prev.map((p) => (p.status === 'ready' ? { ...p, status: 'discarded' as PlanStatus } : p)),
        { id, query: text, tasks: [], status: 'proposing' },
      ])
      void runProposal(id, text)
      return
    }
    setInput('')
    // Reflect the first question in the sidebar title immediately (matches the server, which
    // titles the session from its first persisted user message). Without this the sidebar keeps
    // showing "New Chat" until a reload.
    maybeSetTitleFromFirstMessage(text)
    const parts = buildUserParts(text)
    sendAttachmentsRef.current = attachmentsRef.current.filter((a) => a.att).map((a) => a.att!)
    setAttachments([]) // display cleared for next turn; sendAttachmentsRef carries this turn's files
    setAttachError(null)
    void sendMessage({ parts } as any)
  }

  // Reflect the first question in the sidebar title immediately. In normal mode the server sets
  // the title on the first persisted user message, but a plan proposal persists nothing until the
  // user confirms — so set it optimistically here (updates the store live and persists to DB).
  const maybeSetTitleFromFirstMessage = (text: string) => {
    const title = text.slice(0, 60).trim()
    if (!title || !activeSessionId || messages.length > 0) return
    const store = useSessionStore.getState()
    const current = store.sessions.find((x) => x.id === activeSessionId)
    if (current && (!current.title || current.title === 'New Chat')) {
      void store.updateSessionTitle(activeSessionId, title).catch(() => {})
    }
  }

  // Fill a plan entry's tasks from the server (in place, keeping its id/position). `avoid` is set
  // on 重新计划 to steer toward a different plan.
  const runProposal = async (id: number, query: string, avoid?: string[]) => {
    let tasks: string[]
    try {
      const res = await platform.proposePlan({ sessionId: activeSessionId || '', query, model, avoid })
      tasks = res.tasks.length ? res.tasks : [query]
    } catch {
      tasks = [query] // fall back to a single task so the user can still proceed
    }
    setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, tasks, status: 'ready' } : p)))
  }

  const handleReplan = (entry: PlanEntry) => {
    setPlans((prev) => prev.map((p) => (p.id === entry.id ? { ...p, tasks: [], status: 'proposing' } : p)))
    void runProposal(entry.id, entry.query, entry.tasks)
  }

  // 是: execute the confirmed tasks. planRef feeds the transport (request body) and onFinish.
  // Clear all plan cards (the chosen one becomes a real answer with its own data-plan card; any
  // discarded drafts are done with) but snapshot them first so onError can restore them on failure.
  const handleConfirm = (entry: PlanEntry) => {
    if (entry.status !== 'ready') return
    planRef.current = entry.tasks
    lastPlanTurnRef.current = plans.map((p) => (p.id === entry.id ? { ...p, status: 'done' as PlanStatus } : p))
    const parts = buildUserParts(entry.query)
    sendAttachmentsRef.current = attachmentsRef.current.filter((a) => a.att).map((a) => a.att!)
    setPlans([])
    setAttachments([]) // display cleared; sendAttachmentsRef carries this execution turn's files
    setAttachError(null)
    void sendMessage({ parts } as any)
  }

  return (
    <div className="chat-panel">
      <CopyToast />
      <PasteMenu state={pasteMenu} onClose={() => setPasteMenu(null)} onPaste={pasteIntoInput} />
      <div className="chat-header">
        <span className="chat-title">{session?.title || 'Chat'}</span>
      </div>

      <div className="timeline" ref={timelineRef} role="log" aria-live="polite">
        {messages.length === 0 && !isStreaming && plans.length === 0 && (
          <div className="timeline-empty">
            <h2 className="timeline-empty-title">BloomAI</h2>
            <p className="timeline-empty-desc">Ask anything — streamed directly from the Mastra agent.</p>
          </div>
        )}

        {messages.map((m, idx) => (
          <MessageView
            key={m.id}
            role={m.role}
            parts={(m as any).parts || []}
            streaming={isStreaming && idx === messages.length - 1}
            decidedApprovals={decidedApprovals}
            onDecide={handleDecide}
          />
        ))}

        {waitingForAssistant && (
          <div className="msg-group">
            <div className="msg-avatar">AI</div>
            <div className="msg-col">
              <div className="msg-bubble streaming waiting">
                <WaitingIndicator />
              </div>
            </div>
          </div>
        )}

        {plans.map((p) => (
          <React.Fragment key={p.id}>
            <div className="msg-group user">
              <div className="msg-avatar user">You</div>
              <div className="msg-col">
                <div className="msg-bubble user"><p className="msg-text">{p.query}</p></div>
              </div>
            </div>
            <div className="msg-group">
              <div className="msg-avatar">AI</div>
              <div className="msg-col">
                <div className="msg-bubble">
                  <PlanCard
                    tasks={p.tasks}
                    status={p.status}
                    onConfirm={p.status === 'ready' ? () => handleConfirm(p) : undefined}
                    onReplan={p.status === 'ready' ? () => handleReplan(p) : undefined}
                  />
                </div>
              </div>
            </div>
          </React.Fragment>
        ))}

        {error && (
          <div className="timeline-error-block" role="alert">
            <div className="timeline-error-title">请求失败</div>
            <div className="timeline-error-message">{friendlyError(error)}</div>
          </div>
        )}

      </div>

      <div className="chat-footer">
        <div className="input-area">
          <div className="input-shell">
            {attachError && (
              <div className="attachment-error" role="alert">
                <span className="attachment-error-text">{attachError}</span>
                <button
                  type="button"
                  className="attachment-error-close"
                  onClick={() => setAttachError(null)}
                  title="清除提示"
                  aria-label="清除提示"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            <AttachmentChips items={attachments} onRemove={removeAttachment} />
            <textarea
              ref={inputRef}
              className="input-box"
              value={input}
              placeholder="给 BloomAI 发消息…"
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onContextMenu={handleInputContextMenu}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
            />
            {team === 'writing' && (
              <WriterParams value={writing} onChange={setWriting} disabled={isStreaming} />
            )}
            <div className="input-toolbar">
              <div className="input-toolbar-left">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ATTACHMENT_ACCEPT}
                  style={{ display: 'none' }}
                  onChange={handleFilesSelected}
                />
                <button
                  className="input-icon-btn"
                  title="上传附件（MD/DOCX/PDF/TXT/CSV，单个 ≤5MB）"
                  aria-label="上传附件"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Plus size={17} />
                </button>
                <ModeMenu mode={mode} onSelect={handleModeChange} />
                <ModelMenu model={model} models={textModels.filter(m => m.isEnabled)} onSelect={handleModelChange} up />
                <div className="team-tabs" role="tablist" aria-label="Agent">
                  {TEAM_TABS.map((t) => (
                    <button
                      key={t.id}
                      role="tab"
                      aria-selected={team === t.id}
                      className={cn('team-tab', team === t.id && 'active')}
                      onClick={() => handleTeamToggle(t.id)}
                      title={t.id === 'coding' ? '编码：可读写文件/执行命令，危险操作需你确认' : undefined}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="input-toolbar-right">
                {isStreaming ? (
                  <button className="send-btn" onClick={() => stop()} title="停止">
                    <Loader2 size={16} className="spin" />
                  </button>
                ) : (
                  <button className={cn('send-btn', !canSend && 'disabled')} onClick={handleSend} disabled={!canSend} title={uploading ? '附件上传中…' : '发送'}>
                    <Send size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ModelMenu({ model, models, onSelect, up = false }: { model: string; models: { id: string; label: string; providerId: string }[]; onSelect: (m: string) => void; up?: boolean }) {
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
        <div className={cn('model-dropdown', up && 'up')} role="listbox" aria-label="Select model">
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

function ModeMenu({ mode, onSelect }: { mode: ChatMode; onSelect: (m: ChatMode) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const ActiveIcon = MODE_ICON[mode]
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  return (
    <div className="mode-dropdown-wrap" ref={ref}>
      <button className="mode-pill" onClick={() => setOpen(!open)} aria-haspopup="listbox">
        <ActiveIcon size={14} />
        <span>{MODE_LABEL[mode]}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="mode-dropdown up" role="listbox" aria-label="Select mode">
          {MODE_ORDER.map((m) => {
            const Icon = MODE_ICON[m]
            return (
              <button
                key={m}
                role="option"
                aria-selected={mode === m}
                className={cn('mode-option', mode === m && 'selected')}
                onClick={() => { onSelect(m); setOpen(false) }}
              >
                <Icon size={16} className="mode-option-icon" />
                <span className="mode-option-name">{MODE_LABEL[m]}</span>
                {mode === m && <Check size={12} className="model-check" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

type ApprovalProps = {
  decidedApprovals: Record<string, boolean>
  onDecide: (approvalId: string, approved: boolean) => void
}

function MessageView({ role, parts, streaming, decidedApprovals, onDecide }: { role: string; parts: any[]; streaming?: boolean } & ApprovalProps) {
  if (role === 'user') {
    return <UserMessageView parts={parts} />
  }

  // While streaming, the assistant message can exist before any real content arrives — show the
  // animated indicator inside its bubble instead of an empty bubble until the first part lands.
  const showWaiting = streaming && !hasRenderableContent(parts)
  // The confirmed plan card streams in before the model starts answering; keep the thinking
  // indicator visible below it until real answer content (text/tool/reasoning) shows up.
  const waitingAfterParts = streaming && !showWaiting && !hasAnswerContent(parts)
  // The stream ended with no content (e.g. the model / attachment parse failed). Show a short
  // prompt in the bubble instead of leaving it empty; the full error rides in the timeline block.
  const showEmptyFallback = !streaming && !hasRenderableContent(parts)

  const { bubbleRef, menu, handleContextMenu, closeMenu } = useSelectionMenu<HTMLDivElement>()
  const [liked, setLiked] = useState(false)
  const fullText = assistantPlainText(parts)
  const canCopy = !streaming && !showWaiting && !!fullText

  return (
    <div className="msg-group">
      <div className="msg-avatar">AI</div>
      <div className="msg-col">
        <div
          ref={bubbleRef}
          onContextMenu={handleContextMenu}
          className={cn('msg-bubble', streaming && 'streaming', showWaiting && 'waiting')}
        >
          {showWaiting ? (
            <WaitingIndicator />
          ) : showEmptyFallback ? (
            <p className="msg-text msg-fallback">本次未能生成回答，请稍后重试。</p>
          ) : (
            <>
              {renderAssistantParts(parts, { decidedApprovals, onDecide })}
              {waitingAfterParts && <WaitingIndicator />}
            </>
          )}
        </div>
        {(canCopy || liked) && (
          <div className={cn('msg-actions', liked && 'has-liked')}>
            {canCopy && <CopyButton getText={() => fullText} />}
            {liked && <LikedBadge />}
          </div>
        )}
        <SelectionMenu state={menu} onClose={closeMenu} onLike={() => setLiked(true)} />
      </div>
    </div>
  )
}

/** User's own question bubble. Same right-click 复制 selection menu as answers (点赞 omitted). */
function UserMessageView({ parts }: { parts: any[] }) {
  const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('')
  const { bubbleRef, menu, handleContextMenu, closeMenu } = useSelectionMenu<HTMLDivElement>()
  // Attachments sent with this turn (persisted as a data-attachments part) render as read-only chips.
  const attachmentPart = parts.find((p) => p?.type === 'data-attachments')
  const files: ChipItem[] = Array.isArray(attachmentPart?.data?.files)
    ? attachmentPart.data.files.map((f: any) => ({ id: f.id, name: f.name, ext: f.ext, size: f.size }))
    : []

  return (
    <div className="msg-group user">
      <div className="msg-avatar user">You</div>
      <div className="msg-col">
        {files.length > 0 && <AttachmentChips items={files} compact />}
        {text && (
          <div ref={bubbleRef} onContextMenu={handleContextMenu} className="msg-bubble user">
            <p className="msg-text">{text}</p>
          </div>
        )}
        <SelectionMenu state={menu} onClose={closeMenu} />
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
    } else if (part.type === 'data-plan' && part.data) {
      const tasks = Array.isArray(part.data.tasks) ? part.data.tasks : []
      items.push(<PlanCard key={`plan-${i}`} tasks={tasks} status="done" />)
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
