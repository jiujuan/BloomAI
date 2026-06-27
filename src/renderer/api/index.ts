// Platform abstraction: switches between Electron IPC and direct HTTP fetch
// In Electron: window.bloomai exposes IPC bridge from preload
// In future web: uses fetch + SSE directly

import { API_BASE } from '@shared/constants'
import {
  ResponseStreamEventSchema,
  type ResponseError,
  type ResponseStreamEvent,
} from '@shared/schemas/response'

const DEFAULT_ACTIVE_RESPONSE_RUNTIME = 'mastra-chat-agent-v1' as const

const isElectron = () =>
  typeof window !== 'undefined' && !!(window as any).bloomai

// API helpers

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err.error?.message || `HTTP ${res.status}`)
  }
  return res.json()
}

export type LlmModality = 'text' | 'image' | 'video'

export type LlmProviderSummary = {
  id: string
  name: string
  kind: 'anthropic' | 'openai' | 'openai-compatible' | 'ollama'
  baseUrl: string | null
  isEnabled: boolean
  config: Record<string, unknown>
  hasApiKey: boolean
}

export type LlmModelSummary = {
  id: string
  providerId: string
  modelId: string
  label: string
  modality: LlmModality
  capabilities: Record<string, unknown>
  isEnabled: boolean
  isBuiltin: boolean
  sortOrder: number
}

export type OllamaRemoteModel = {
  name: string
  modifiedAt?: string
  size?: number
  digest?: string
  details?: Record<string, unknown>
}

// Platform API

export const platform = {
  // Sessions
  async getSessions() {
    const { data } = await apiFetch('/sessions')
    return data
  },
  async createSession(opts: { title?: string; persona_id?: string; model?: string } = {}) {
    const { data } = await apiFetch('/sessions', { method: 'POST', body: JSON.stringify(opts) })
    return data
  },
  async updateSession(id: string, updates: object) {
    const { data } = await apiFetch(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(updates) })
    return data
  },
  async deleteSession(id: string) {
    await apiFetch(`/sessions/${id}`, { method: 'DELETE' })
  },
  async getMessages(sessionId: string) {
    const { data } = await apiFetch(`/sessions/${sessionId}/messages`)
    return data
  },

  // Personas
  async getPersonas() {
    const { data } = await apiFetch('/personas')
    return data
  },
  async createPersona(data: { name: string; system_prompt: string; model_override?: string }) {
    const { data: result } = await apiFetch('/personas', { method: 'POST', body: JSON.stringify(data) })
    return result
  },
  async updatePersona(id: string, updates: object) {
    const { data } = await apiFetch(`/personas/${id}`, { method: 'PATCH', body: JSON.stringify(updates) })
    return data
  },
  async deletePersona(id: string) {
    await apiFetch(`/personas/${id}`, { method: 'DELETE' })
  },

  // Settings
  async getSettings() {
    const { data } = await apiFetch('/settings')
    return data
  },
  async updateSettings(updates: Record<string, string>) {
    const { data } = await apiFetch('/settings', { method: 'PATCH', body: JSON.stringify(updates) })
    return data
  },

  // LLM registry
  async getLlmProviders(): Promise<LlmProviderSummary[]> {
    const { data } = await apiFetch('/llm/providers')
    return data
  },
  async updateLlmProvider(id: string, updates: object): Promise<LlmProviderSummary> {
    const { data } = await apiFetch(`/llm/providers/${id}`, { method: 'PATCH', body: JSON.stringify(updates) })
    return data
  },
  async getLlmModels(modality?: LlmModality): Promise<LlmModelSummary[]> {
    const suffix = modality ? `?modality=${encodeURIComponent(modality)}` : ''
    const { data } = await apiFetch(`/llm/models${suffix}`)
    return data
  },
  async createLlmModel(input: object): Promise<LlmModelSummary> {
    const { data } = await apiFetch('/llm/models', { method: 'POST', body: JSON.stringify(input) })
    return data
  },
  async updateLlmModel(id: string, updates: object): Promise<LlmModelSummary> {
    const { data } = await apiFetch(`/llm/models/${id}`, { method: 'PATCH', body: JSON.stringify(updates) })
    return data
  },
  async getOllamaModels(): Promise<OllamaRemoteModel[]> {
    const { data } = await apiFetch('/llm/ollama/models')
    return data
  },

  // Chat streaming is v1-only; backend SSE payloads are validated and yielded without legacy normalization.
  async *chatStream(payload: { sessionId: string; content: string; contextOverride?: object }): AsyncGenerator<ResponseStreamEvent> {
    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.body) throw new Error('No response body')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const streamState: ChatStreamParseState = { responseStarted: false, responseId: createId() }
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = done ? '' : lines.pop() || ''

        for (const line of lines) {
          const result = parseChatStreamLine(line, payload.sessionId, streamState)
          if (result.kind === 'done') return
          if (result.kind === 'failed') {
            for (const event of result.events) yield event
            return
          }
          if (result.kind === 'event') yield result.event
        }

        if (done) break
      }
    } catch (error) {
      for (const event of createFailureEvents(payload.sessionId, streamState, createStreamFailure(error))) yield event
    }
  },
  // Clipboard (Electron only, graceful fallback)
  async readClipboard(): Promise<string> {
    if (isElectron()) return (window as any).bloomai.readClipboard()
    try { return await navigator.clipboard.readText() } catch { return '' }
  },

  // Active window (Electron only)
  async getActiveWindow(): Promise<string> {
    if (isElectron()) return (window as any).bloomai.getActiveWindow()
    return ''
  },

  // Theme
  async setTheme(theme: 'light' | 'dark' | 'system') {
    await platform.updateSettings({ theme })
    applyTheme(theme)
  },
}

type ChatStreamParseState = {
  responseStarted: boolean
  responseId: string
}

type ParsedChatStreamLine =
  | { kind: 'skip' }
  | { kind: 'done' }
  | { kind: 'event'; event: ResponseStreamEvent }
  | { kind: 'failed'; events: ResponseStreamEvent[] }

function parseChatStreamLine(
  line: string,
  sessionId: string,
  state: ChatStreamParseState,
): ParsedChatStreamLine {
  if (!line.startsWith('data: ')) return { kind: 'skip' }
  const raw = line.slice(6).trim()
  if (raw === '[DONE]') return { kind: 'done' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      kind: 'failed',
      events: createFailureEvents(sessionId, state, {
        code: 'MALFORMED_CHAT_STREAM_EVENT',
        message: error instanceof Error ? error.message : 'Malformed chat stream event.',
      }),
    }
  }

  const event = ResponseStreamEventSchema.safeParse(parsed)
  if (!event.success) {
    return {
      kind: 'failed',
      events: createFailureEvents(sessionId, state, {
        code: 'MALFORMED_CHAT_STREAM_EVENT',
        message: 'Received a non-v1 chat stream event.',
        details: event.error.flatten(),
      }),
    }
  }

  const responseEvent = event.data as ResponseStreamEvent

  // response_started anchors failure synthesis to the backend response id for later malformed/abort handling.
  if (responseEvent.type === 'response_started') {
    state.responseStarted = true
    state.responseId = responseEvent.responseId
  }

  return { kind: 'event', event: responseEvent }
}

function createFailureEvents(
  sessionId: string,
  state: ChatStreamParseState,
  error: ResponseError,
): ResponseStreamEvent[] {
  const completedAt = Date.now()
  const responseId = state.responseId
  const events: ResponseStreamEvent[] = []
  if (!state.responseStarted) {
    events.push({
      type: 'response_started',
      responseId,
      sessionId,
      runtime: DEFAULT_ACTIVE_RESPONSE_RUNTIME,
      createdAt: completedAt,
    })
    state.responseStarted = true
  }
  events.push({
    type: 'response_failed',
    responseId,
    error,
    completedAt,
  })
  return events
}

function createStreamFailure(error: unknown): ResponseError {
  return {
    code: isAbortOrDisconnect(error) ? 'STREAM_ABORTED' : 'CHAT_STREAM_ERROR',
    message: getErrorMessage(error, 'Chat stream failed.'),
  }
}

function isAbortOrDisconnect(error: unknown): boolean {
  if (error instanceof Error) {
    const name = error.name.toLowerCase()
    const message = error.message.toLowerCase()
    return name === 'aborterror'
      || message.includes('abort')
      || message.includes('cancel')
      || message.includes('disconnect')
      || message.includes('network')
  }
  if (typeof error === 'string') {
    const message = error.toLowerCase()
    return message.includes('abort')
      || message.includes('cancel')
      || message.includes('disconnect')
      || message.includes('network')
  }
  return false
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `response-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
export function applyTheme(theme: 'light' | 'dark' | 'system') {
  const root = document.documentElement
  if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    root.setAttribute('data-theme', 'dark')
  } else {
    root.setAttribute('data-theme', 'light')
  }
}