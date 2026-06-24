import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { platform } from '@renderer/api'
import type { LlmModelSummary, ChatStreamEvent } from '@renderer/api'
import type { Session, Message, Persona } from '@shared/schemas'

// ── Session Store ────────────────────────────────────────────────────────────

interface SessionState {
  sessions: Session[]
  activeSessionId: string | null
  loading: boolean
}
interface SessionActions {
  loadSessions: () => Promise<void>
  createSession: (opts?: { persona_id?: string; model?: string }) => Promise<Session>
  deleteSession: (id: string) => Promise<void>
  setActiveSession: (id: string) => void
  updateSessionTitle: (id: string, title: string) => void
}

export const useSessionStore = create<SessionState & SessionActions>()(
  devtools((set, get) => ({
    sessions: [],
    activeSessionId: null,
    loading: false,

    loadSessions: async () => {
      set({ loading: true })
      try {
        const sessions = await platform.getSessions()
        set({ sessions, loading: false })
      } catch (e) {
        console.error('loadSessions', e)
        set({ loading: false })
      }
    },

    createSession: async (opts = {}) => {
      const session = await platform.createSession(opts)
      set(s => ({ sessions: [session, ...s.sessions], activeSessionId: session.id }))
      return session
    },

    deleteSession: async (id: string) => {
      await platform.deleteSession(id)
      set(s => {
        const sessions = s.sessions.filter(x => x.id !== id)
        const activeSessionId = s.activeSessionId === id
          ? (sessions[0]?.id || null)
          : s.activeSessionId
        return { sessions, activeSessionId }
      })
    },

    setActiveSession: (id: string) => set({ activeSessionId: id }),

    updateSessionTitle: (id: string, title: string) => {
      set(s => ({
        sessions: s.sessions.map(x => x.id === id ? { ...x, title } : x)
      }))
      platform.updateSession(id, { title }).catch(() => {})
    },
  }), { name: 'bloomai-sessions' })
)

// ── Chat Store ───────────────────────────────────────────────────────────────

export type ToolCallState = {
  callId: string
  toolId: string
  category: string
  status: 'running' | 'success' | 'error'
  input: Record<string, unknown>
  output?: unknown
  error?: string
  durationMs?: number
}

interface ChatState {
  messagesBySession: Record<string, Message[]>
  streamingText: string
  isStreaming: boolean
  streamError: string | null
  tokenUsage: Record<string, { input: number; output: number }>
  toolCallsBySession: Record<string, ToolCallState[]>
}
interface ChatActions {
  loadMessages: (sessionId: string) => Promise<void>
  sendMessage: (sessionId: string, content: string, contextOverride?: object) => Promise<void>
  clearMessages: (sessionId: string) => void
  clearStreamingToolCalls: (sessionId: string) => void
  setStreamError: (error: string | null) => void
}

export const useChatStore = create<ChatState & ChatActions>()(
  devtools((set, get) => ({
    messagesBySession: {},
    streamingText: '',
    isStreaming: false,
    streamError: null,
    tokenUsage: {},
    toolCallsBySession: {},

    loadMessages: async (sessionId: string) => {
      if (get().messagesBySession[sessionId]) return
      try {
        const messages = await platform.getMessages(sessionId)
        set(s => ({ messagesBySession: { ...s.messagesBySession, [sessionId]: messages } }))
      } catch (e) {
        console.error('loadMessages', e)
      }
    },

    sendMessage: async (sessionId: string, content: string, contextOverride?: object) => {
      if (get().isStreaming) return
      set(s => ({ toolCallsBySession: { ...s.toolCallsBySession, [sessionId]: [] } }))
      const userMsg: Message = {
        id: `tmp-${Date.now()}`,
        session_id: sessionId,
        role: 'user',
        content,
        created_at: Date.now(),
      }
      set(s => ({
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: [...(s.messagesBySession[sessionId] || []), userMsg],
        },
        isStreaming: true,
        streamingText: '',
        streamError: null,
      }))

      // Update session order in session store
      useSessionStore.setState(s => ({
        sessions: s.sessions.map(sess =>
          sess.id === sessionId ? { ...sess, updated_at: Date.now() } : sess
        ).sort((a, b) => b.updated_at - a.updated_at)
      }))

      let fullText = ''
      try {
        for await (const chunk of platform.chatStream({ sessionId, content, contextOverride })) {
          if (chunk.type === 'delta' && chunk.text) {
            fullText += chunk.text
            set({ streamingText: fullText })
            continue
          }

          if (chunk.type === 'tool_call_start') {
            set(s => ({
              toolCallsBySession: {
                ...s.toolCallsBySession,
                [sessionId]: [
                  ...(s.toolCallsBySession[sessionId] || []).filter(call => call.callId !== chunk.call.callId),
                  {
                    callId: chunk.call.callId,
                    toolId: chunk.call.toolId,
                    category: chunk.call.category,
                    status: 'running',
                    input: chunk.call.input,
                  },
                ],
              },
            }))
            continue
          }

          if (chunk.type === 'tool_call_result') {
            set(s => ({
              toolCallsBySession: {
                ...s.toolCallsBySession,
                [sessionId]: (s.toolCallsBySession[sessionId] || []).map(call =>
                  call.callId === chunk.callId
                    ? { ...call, status: 'success', output: chunk.output, durationMs: chunk.durationMs }
                    : call
                ),
              },
            }))
            continue
          }

          if (chunk.type === 'tool_call_error') {
            set(s => ({
              toolCallsBySession: {
                ...s.toolCallsBySession,
                [sessionId]: (s.toolCallsBySession[sessionId] || []).map(call =>
                  call.callId === chunk.callId
                    ? { ...call, status: 'error', error: chunk.error }
                    : call
                ),
              },
            }))
            continue
          }

          if (chunk.type === 'error') {
            set({ streamError: chunk.error || 'Unknown error', isStreaming: false, streamingText: '' })
            return
          }
          if (chunk.type === 'done') {
            if (chunk.tokens) {
              set(s => ({
                tokenUsage: {
                  ...s.tokenUsage,
                  [sessionId]: chunk.tokens as { input: number; output: number }
                }
              }))
            }
          }
        }
        const assistantMsg: Message = {
          id: `tmp-ai-${Date.now()}`,
          session_id: sessionId,
          role: 'assistant',
          content: fullText,
          created_at: Date.now(),
        }
        set(s => ({
          messagesBySession: {
            ...s.messagesBySession,
            [sessionId]: [...(s.messagesBySession[sessionId] || []), assistantMsg],
          },
          isStreaming: false,
          streamingText: '',
        }))
        // Reload messages from server to get real IDs
        const messages = await platform.getMessages(sessionId)
        set(s => ({ messagesBySession: { ...s.messagesBySession, [sessionId]: messages } }))
        // Update session title from server
        const sessions = await platform.getSessions()
        useSessionStore.setState({ sessions })
      } catch (err: any) {
        set({ streamError: err.message, isStreaming: false, streamingText: '' })
      }
    },

    clearMessages: (sessionId: string) => {
      set(s => {
        const next = { ...s.messagesBySession }
        delete next[sessionId]
        const nextToolCalls = { ...s.toolCallsBySession }
        delete nextToolCalls[sessionId]
        return { messagesBySession: next, toolCallsBySession: nextToolCalls }
      })
    },

    clearStreamingToolCalls: (sessionId: string) => {
      set(s => ({ toolCallsBySession: { ...s.toolCallsBySession, [sessionId]: [] } }))
    },

    setStreamError: (error) => set({ streamError: error }),
  }), { name: 'bloomai-chat' })
)

// ── Persona Store ────────────────────────────────────────────────────────────

interface PersonaState {
  personas: Persona[]
  activePersonaId: string | null
}
interface PersonaActions {
  loadPersonas: () => Promise<void>
  createPersona: (data: { name: string; system_prompt: string; model_override?: string }) => Promise<void>
  updatePersona: (id: string, data: object) => Promise<void>
  deletePersona: (id: string) => Promise<void>
  setActivePersona: (id: string | null) => void
}

export const usePersonaStore = create<PersonaState & PersonaActions>()(
  devtools((set, get) => ({
    personas: [],
    activePersonaId: 'developer',

    loadPersonas: async () => {
      const personas = await platform.getPersonas()
      set({ personas })
    },

    createPersona: async (data) => {
      const persona = await platform.createPersona(data)
      set(s => ({ personas: [...s.personas, persona] }))
    },

    updatePersona: async (id, data) => {
      await platform.updatePersona(id, data)
      const personas = await platform.getPersonas()
      set({ personas })
    },

    deletePersona: async (id) => {
      await platform.deletePersona(id)
      set(s => ({ personas: s.personas.filter(p => p.id !== id) }))
    },

    setActivePersona: (id) => set({ activePersonaId: id }),
  }), { name: 'bloomai-personas' })
)

// ── Settings Store ───────────────────────────────────────────────────────────

interface SettingsState {
  settings: Record<string, string>
  loaded: boolean
}
interface SettingsActions {
  loadSettings: () => Promise<void>
  updateSetting: (key: string, value: string) => Promise<void>
  updateSettings: (updates: Record<string, string>) => Promise<void>
}

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  devtools((set, get) => ({
    settings: {},
    loaded: false,

    loadSettings: async () => {
      const settings = await platform.getSettings()
      set({ settings, loaded: true })
    },

    updateSetting: async (key, value) => {
      set(s => ({ settings: { ...s.settings, [key]: value } }))
      await platform.updateSettings({ [key]: value })
    },

    updateSettings: async (updates) => {
      set(s => ({ settings: { ...s.settings, ...updates } }))
      await platform.updateSettings(updates)
    },
  }), { name: 'bloomai-settings' })
)

// ── LLM Store ───────────────────────────────────────────────────────────────

interface LlmState {
  textModels: LlmModelSummary[]
  imageModels: LlmModelSummary[]
  videoModels: LlmModelSummary[]
  loading: boolean
  error: string | null
}
interface LlmActions {
  loadModels: () => Promise<void>
  loadTextModels: () => Promise<void>
}

export const useLlmStore = create<LlmState & LlmActions>()(
  devtools((set) => ({
    textModels: [],
    imageModels: [],
    videoModels: [],
    loading: false,
    error: null,

    loadModels: async () => {
      set({ loading: true, error: null })
      try {
        const [textModels, imageModels, videoModels] = await Promise.all([
          platform.getLlmModels('text'),
          platform.getLlmModels('image'),
          platform.getLlmModels('video'),
        ])
        set({ textModels, imageModels, videoModels, loading: false })
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load models',
        })
      }
    },

    loadTextModels: async () => {
      set({ loading: true, error: null })
      try {
        const textModels = await platform.getLlmModels('text')
        set({ textModels, loading: false })
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load text models',
        })
      }
    },
  }), { name: 'bloomai-llm' })
)

// ── UI Store ─────────────────────────────────────────────────────────────────

interface UIState {
  sidebarOpen: boolean
  activePage: 'chat' | 'settings' | 'personas' | 'tools' | 'skills'
  theme: 'light' | 'dark' | 'system'
  showOnboarding: boolean
}
interface UIActions {
  toggleSidebar: () => void
  setPage: (page: UIState['activePage']) => void
  setTheme: (theme: UIState['theme']) => void
  setShowOnboarding: (show: boolean) => void
}

export const useUIStore = create<UIState & UIActions>()(
  devtools((set) => ({
    sidebarOpen: true,
    activePage: 'chat',
    theme: 'system',
    showOnboarding: false,

    toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
    setPage: (activePage) => set({ activePage }),
    setTheme: (theme) => {
      set({ theme })
      platform.setTheme(theme)
    },
    setShowOnboarding: (showOnboarding) => set({ showOnboarding }),
  }), { name: 'bloomai-ui' })
)
