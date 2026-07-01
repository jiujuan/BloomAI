// Platform abstraction: switches between Electron IPC and direct HTTP fetch
// In Electron: window.bloomai exposes IPC bridge from preload
// In future web: uses fetch + SSE directly

import { API_BASE } from '@shared/constants'

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
  // Persist a finished assistant message with its full UI parts (tool/reasoning/workflow cards)
  // so they survive reloads. Fire-and-forget from useChat's onFinish.
  async saveAssistantMessage(payload: { sessionId: string; content: string; parts: unknown[]; model?: string; tokens?: number }) {
    await apiFetch('/chat/assistant', { method: 'POST', body: JSON.stringify(payload) })
  },
  // Plan mode step 1: propose a short task list for the user to confirm. `avoid` lets
  // "重新计划" ask for a different plan than the one just shown.
  async proposePlan(p: { sessionId: string; query: string; model?: string; avoid?: string[] }): Promise<{ tasks: string[] }> {
    const { data } = await apiFetch('/chat/plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bloom-model': p.model || '',
        'x-bloom-session': p.sessionId || '',
      },
      body: JSON.stringify({ query: p.query, avoid: p.avoid || [] }),
    })
    return { tasks: Array.isArray(data?.tasks) ? data.tasks : [] }
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

export function applyTheme(theme: 'light' | 'dark' | 'system') {
  const root = document.documentElement
  if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    root.setAttribute('data-theme', 'dark')
  } else {
    root.setAttribute('data-theme', 'light')
  }
}