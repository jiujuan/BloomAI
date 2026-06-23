// Platform abstraction — switches between Electron IPC and direct HTTP fetch
// In Electron: window.bloomai exposes IPC bridge from preload
// In future web: uses fetch + SSE directly

import { API_BASE } from '@shared/constants'

const isElectron = () =>
  typeof window !== 'undefined' && !!(window as any).bloomai

// ── API helpers ────────────────────────────────────────────────────────────

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

// ── Sessions ────────────────────────────────────────────────────────────────

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

  // Chat streaming — returns an async generator of SSE events
  async *chatStream(payload: { sessionId: string; content: string; contextOverride?: object }): AsyncGenerator<{ type: string; text?: string; error?: string; tokens?: object }> {
    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.body) throw new Error('No response body')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') return
          try { yield JSON.parse(raw) } catch { /* skip */ }
        }
      }
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

export function applyTheme(theme: 'light' | 'dark' | 'system') {
  const root = document.documentElement
  if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    root.setAttribute('data-theme', 'dark')
  } else {
    root.setAttribute('data-theme', 'light')
  }
}
