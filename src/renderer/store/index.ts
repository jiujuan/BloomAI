import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { platform } from '@renderer/api'
import type { LlmModelSummary } from '@renderer/api'
import type { Message, Persona, Session } from '@shared/schemas'
import {
  deriveStreamingText,
  reduceStreamingResponse,
  type StreamingResponseState,
} from './chat-response-reducer'

// Session Store

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
  updateSessionTitle: (id: string, title: string) => Promise<void>
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

    updateSessionTitle: async (id: string, title: string) => {
      const previousTitle = get().sessions.find(x => x.id === id)?.title
      set(s => ({
        sessions: s.sessions.map(x => x.id === id ? { ...x, title } : x)
      }))
      try {
        await platform.updateSession(id, { title })
      } catch (error) {
        if (previousTitle !== undefined) {
          set(s => ({
            sessions: s.sessions.map(x => x.id === id ? { ...x, title: previousTitle } : x)
          }))
        }
        throw error
      }
    },
  }), { name: 'bloomai-sessions' })
)

// Chat Store

interface ChatState {
  messagesBySession: Record<string, Message[]>
  isStreaming: boolean
  tokenUsage: Record<string, { input: number; output: number }>
  streamingResponsesBySession: Record<string, StreamingResponseState | null>
}
interface ChatActions {
  loadMessages: (sessionId: string) => Promise<void>
  sendMessage: (sessionId: string, content: string, contextOverride?: object) => Promise<void>
  clearMessages: (sessionId: string) => void
}

export const useChatStore = create<ChatState & ChatActions>()(
  devtools((set, get) => ({
    messagesBySession: {},
    isStreaming: false,
    tokenUsage: {},
    streamingResponsesBySession: {},

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
      set(s => ({
        streamingResponsesBySession: { ...s.streamingResponsesBySession, [sessionId]: null },
      }))
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
      }))

      useSessionStore.setState(s => ({
        sessions: s.sessions.map(sess =>
          sess.id === sessionId ? { ...sess, updated_at: Date.now() } : sess
        ).sort((a, b) => b.updated_at - a.updated_at)
      }))

      try {
        for await (const event of platform.chatStream({ sessionId, content, contextOverride })) {
          set((state) => {
            const current = state.streamingResponsesBySession[sessionId] ?? null
            const next = reduceStreamingResponse(current, event, sessionId)
            const nextUsage = event.type === 'usage_updated' || event.type === 'response_completed'
              ? mergeTokenUsage(state.tokenUsage, sessionId, next?.usage)
              : state.tokenUsage
            return {
              streamingResponsesBySession: {
                ...state.streamingResponsesBySession,
                [sessionId]: next,
              },
              tokenUsage: nextUsage,
            }
          })
        }

        const finalResponse = get().streamingResponsesBySession[sessionId] ?? null
        const responseFailed = Boolean(finalResponse?.error)
        const assistantText = deriveStreamingText(finalResponse)
        if (!responseFailed && assistantText) {
          const assistantMsg: Message = {
            id: `tmp-ai-${Date.now()}`,
            session_id: sessionId,
            role: 'assistant',
            content: assistantText,
            created_at: Date.now(),
          }
          set(s => ({
            messagesBySession: {
              ...s.messagesBySession,
              [sessionId]: [...(s.messagesBySession[sessionId] || []), assistantMsg],
            },
          }))
        }

        set(s => ({
          isStreaming: false,
          streamingResponsesBySession: {
            ...s.streamingResponsesBySession,
            [sessionId]: responseFailed ? finalResponse : null,
          },
        }))
        if (responseFailed) return

        // Persisted messages replace temporary rows only after the v1 response stream completes successfully.
        const messages = await platform.getMessages(sessionId)
        set(s => ({ messagesBySession: { ...s.messagesBySession, [sessionId]: messages } }))
        const sessions = await platform.getSessions()
        useSessionStore.setState({ sessions })
      } catch (err: any) {
        const message = err instanceof Error ? err.message : 'Stream failed'
        const current = get().streamingResponsesBySession[sessionId] ?? null
        const failedResponse = current && !current.isComplete
          ? reduceStreamingResponse(current, {
              type: 'response_failed',
              responseId: current.responseId,
              error: { code: 'UNKNOWN_ERROR', message },
              completedAt: Date.now(),
            }, sessionId)
          : current
        set(s => ({
          isStreaming: false,
          streamingResponsesBySession: {
            ...s.streamingResponsesBySession,
            [sessionId]: failedResponse,
          },
        }))
      }
    },

    clearMessages: (sessionId: string) => {
      set(s => {
        const next = { ...s.messagesBySession }
        delete next[sessionId]
        const nextStreamingResponses = { ...s.streamingResponsesBySession }
        delete nextStreamingResponses[sessionId]
        return { messagesBySession: next, streamingResponsesBySession: nextStreamingResponses }
      })
    },
  }), { name: 'bloomai-chat' })
)

function mergeTokenUsage(
  current: Record<string, { input: number; output: number }>,
  sessionId: string,
  usage: StreamingResponseState['usage'],
): Record<string, { input: number; output: number }> {
  if (!usage) return current
  return {
    ...current,
    [sessionId]: {
      input: usage.inputTokens ?? 0,
      output: usage.outputTokens ?? 0,
    },
  }
}
// Persona Store

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

// Settings Store

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

// LLM Store

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

// UI Store

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

