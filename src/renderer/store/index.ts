import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { platform } from '@renderer/api'
import type { ImageGenerationRecord, ImageSessionSummary, LlmModelSummary } from '@renderer/api'
import type { Message, Persona, Session } from '@shared/schemas'
import { DEFAULT_ASPECT_RATIO } from '@shared/image-gen'
import type { ImageTemplateDef } from '@shared/image-templates'

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
// Message streaming moved to useChat (AI SDK UI) in ChatPanelMastra. This store now
// only caches persisted message history for sidebar prefetch.

interface ChatState {
  messagesBySession: Record<string, Message[]>
}
interface ChatActions {
  loadMessages: (sessionId: string) => Promise<void>
  clearMessages: (sessionId: string) => void
}

export const useChatStore = create<ChatState & ChatActions>()(
  devtools((set, get) => ({
    messagesBySession: {},

    loadMessages: async (sessionId: string) => {
      if (get().messagesBySession[sessionId]) return
      try {
        const messages = await platform.getMessages(sessionId)
        set(s => ({ messagesBySession: { ...s.messagesBySession, [sessionId]: messages } }))
      } catch (e) {
        console.error('loadMessages', e)
      }
    },

    clearMessages: (sessionId: string) => {
      set(s => {
        const next = { ...s.messagesBySession }
        delete next[sessionId]
        return { messagesBySession: next }
      })
    },
  }), { name: 'bloomai-chat' })
)
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
  activePage: 'chat' | 'settings' | 'personas' | 'tools' | 'skills' | 'image' | 'article-illustration'
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

// Image Studio Store (AI 画图)

export interface ImageComposerState {
  prompt: string
  model: string
  aspectRatioId: string
  styleId: string | null
  referenceImages: string[]
  optimize: boolean
}

function initialComposer(): ImageComposerState {
  return { prompt: '', model: '', aspectRatioId: DEFAULT_ASPECT_RATIO, styleId: null, referenceImages: [], optimize: true }
}

interface ImageState {
  sessions: ImageSessionSummary[]
  activeSessionId: string | null
  generationsBySession: Record<string, ImageGenerationRecord[]>
  composer: ImageComposerState
  generating: boolean
  loading: boolean
}
interface ImageActions {
  loadSessions: () => Promise<void>
  createSession: () => Promise<ImageSessionSummary>
  setActiveSession: (id: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  loadGenerations: (sessionId: string) => Promise<void>
  setComposer: (patch: Partial<ImageComposerState>) => void
  addReferenceImages: (uris: string[]) => void
  removeReferenceImage: (index: number) => void
  applyTemplate: (t: ImageTemplateDef) => void
  generate: () => Promise<void>
}

export const useImageStore = create<ImageState & ImageActions>()(
  devtools((set, get) => ({
    sessions: [],
    activeSessionId: null,
    generationsBySession: {},
    composer: initialComposer(),
    generating: false,
    loading: false,

    loadSessions: async () => {
      set({ loading: true })
      try {
        const sessions = await platform.image.listSessions()
        set({ sessions, loading: false })
        if (!get().activeSessionId && sessions[0]) await get().setActiveSession(sessions[0].id)
      } catch (e) {
        console.error('image.loadSessions', e)
        set({ loading: false })
      }
    },

    createSession: async () => {
      const session = await platform.image.createSession()
      set(s => ({
        sessions: [session, ...s.sessions],
        activeSessionId: session.id,
        generationsBySession: { ...s.generationsBySession, [session.id]: [] },
        composer: { ...s.composer, prompt: '', referenceImages: [] },
      }))
      return session
    },

    setActiveSession: async (id) => {
      set({ activeSessionId: id })
      await get().loadGenerations(id)
      const session = get().sessions.find(s => s.id === id)
      if (session?.default_model && !get().composer.model) {
        set(s => ({ composer: { ...s.composer, model: session.default_model as string } }))
      }
    },

    deleteSession: async (id) => {
      await platform.image.deleteSession(id)
      set(s => {
        const sessions = s.sessions.filter(x => x.id !== id)
        const activeSessionId = s.activeSessionId === id ? (sessions[0]?.id || null) : s.activeSessionId
        return { sessions, activeSessionId }
      })
      const next = get().activeSessionId
      if (next) await get().loadGenerations(next)
    },

    renameSession: async (id, title) => {
      set(s => ({ sessions: s.sessions.map(x => x.id === id ? { ...x, title } : x) }))
      await platform.image.renameSession(id, title)
    },

    loadGenerations: async (sessionId) => {
      try {
        const gens = await platform.image.listGenerations(sessionId)
        set(s => ({ generationsBySession: { ...s.generationsBySession, [sessionId]: gens } }))
      } catch (e) {
        console.error('image.loadGenerations', e)
      }
    },

    setComposer: (patch) => set(s => ({ composer: { ...s.composer, ...patch } })),

    // Reference images (图生图). Capped at 4; duplicates ignored.
    addReferenceImages: (uris) => set(s => {
      const merged = [...s.composer.referenceImages]
      for (const u of uris) {
        if (u && !merged.includes(u) && merged.length < 4) merged.push(u)
      }
      return { composer: { ...s.composer, referenceImages: merged } }
    }),

    removeReferenceImage: (index) => set(s => ({
      composer: { ...s.composer, referenceImages: s.composer.referenceImages.filter((_, i) => i !== index) },
    })),

    applyTemplate: (t) => set(s => ({
      composer: {
        ...s.composer,
        prompt: t.prompt,
        model: t.recommend?.model || s.composer.model,
        aspectRatioId: t.recommend?.ratioId || s.composer.aspectRatioId,
        styleId: t.recommend?.styleId ?? s.composer.styleId,
      },
    })),

    generate: async () => {
      const { activeSessionId, composer, generating } = get()
      if (generating || !composer.prompt.trim() || !composer.model) return
      let sessionId = activeSessionId
      if (!sessionId) sessionId = (await get().createSession()).id

      // Optimistic placeholder while the provider works (generation can take 10-60s).
      const tempId = `temp-${Date.now()}`
      const placeholder: ImageGenerationRecord = {
        id: tempId, session_id: sessionId, message_id: null,
        prompt: composer.prompt, resolved_prompt: null, provider_id: '', model: composer.model,
        aspect_ratio: composer.aspectRatioId, style: composer.styleId, size: null, seed: null,
        reference_images: null, status: 'in_progress', provider_task_id: null, progress: null,
        url: null, local_path: null, error_msg: null, duration_ms: null,
        created_at: Date.now(), updated_at: Date.now(),
      }
      const sid = sessionId
      set(s => ({
        generating: true,
        generationsBySession: { ...s.generationsBySession, [sid]: [...(s.generationsBySession[sid] || []), placeholder] },
      }))

      try {
        const record = await platform.image.generate({
          sessionId: sid,
          prompt: composer.prompt,
          model: composer.model,
          aspectRatioId: composer.aspectRatioId,
          styleId: composer.styleId,
          referenceImages: composer.referenceImages.length ? composer.referenceImages : undefined,
          optimize: composer.optimize,
        })
        set(s => ({
          generating: false,
          composer: { ...s.composer, prompt: '' },
          generationsBySession: {
            ...s.generationsBySession,
            [sid]: (s.generationsBySession[sid] || []).map(g => g.id === tempId ? record : g),
          },
        }))
        // Refresh session list so an auto-titled session shows its new name and ordering.
        await get().loadSessions()
        set({ activeSessionId: sid })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Image generation failed'
        set(s => ({
          generating: false,
          generationsBySession: {
            ...s.generationsBySession,
            [sid]: (s.generationsBySession[sid] || []).map(g => g.id === tempId ? { ...g, status: 'failed' as const, error_msg: message } : g),
          },
        }))
      }
    },
  }), { name: 'bloomai-image' })
)

