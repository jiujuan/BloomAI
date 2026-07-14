// Platform abstraction: switches between Electron IPC and direct HTTP fetch
// In Electron: window.bloomai exposes IPC bridge from preload
// In future web: uses fetch + SSE directly

import { API_BASE } from '@shared/constants'
import type { Attachment } from '@shared/attachments'

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
  // 204 No Content (e.g. DELETE) carries no body 鈥?calling res.json() would throw.
  if (res.status === 204) return null
  return res.json()
}

export type LlmModality = 'text' | 'image' | 'video'
export type ArticleIllustrationSceneDto = { id: string; ordinal: number; title: string; excerpt: string; prompt: string; status: string; generation_id: string | null; error_message: string | null; retry_count: number }
export type ArticleIllustrationJobDto = { id: string; source_type: 'text' | 'url' | 'file'; source_label: string; source_url: string | null; article_text: string; mode: 'skill' | 'fallback'; skill_version_id: string | null; run_id: string | null; image_session_id: string | null; config: Record<string, unknown>; status: string; error_message: string | null; scenes: ArticleIllustrationSceneDto[] }
export type EligibleImageSkillDto = { packageId: string; packageName: string; skillVersionId: string; version: string; requiredCapabilities: string[]; activeImageGrant: { grantMode: string; maxCalls: number | null; allowedModels: string[] | null } | null }

export type LlmProviderSummary = {
  id: string
  name: string
  kind: 'anthropic' | 'openai' | 'openai-compatible' | 'ollama'
  baseUrl: string | null
  apiKeySettingKey: string | null
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

// AI 鐢诲浘 (Image Studio) types 鈥?snake_case to match server rows (like Message/Session).

export type ImageSessionSummary = {
  id: string
  title: string
  default_model: string | null
  status: string
  created_at: number
  updated_at: number
}

export type ImageGenerationRecord = {
  id: string
  session_id: string
  message_id: string | null
  prompt: string
  resolved_prompt: string | null
  provider_id: string
  model: string
  aspect_ratio: string | null
  style: string | null
  size: string | null
  seed: number | null
  reference_images: string | null
  status: 'queued' | 'in_progress' | 'completed' | 'failed'
  provider_task_id: string | null
  progress: number | null
  url: string | null
  local_path: string | null
  error_msg: string | null
  duration_ms: number | null
  created_at: number
  updated_at: number
}

export type ImageGeneratePayload = {
  sessionId: string
  prompt: string
  model: string
  aspectRatioId?: string
  styleId?: string | null
  referenceImages?: string[]
  negativePrompt?: string
  seed?: number
  optimize?: boolean
}

/** URL the renderer uses to display a locally-saved generated image. */
export function imageMediaUrl(genId: string): string {
  return `${API_BASE}/media/image/${genId}`
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
  // "閲嶆柊璁″垝" ask for a different plan than the one just shown.
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

  // Chat attachments: upload one or more files as multipart/form-data (not JSON, so this
  // bypasses apiFetch's forced Content-Type). Returns stored metadata used on the next send.
  async uploadAttachments(files: File[]): Promise<Attachment[]> {
    const form = new FormData()
    for (const f of files) form.append('file', f)
    const res = await fetch(`${API_BASE}/attachments`, { method: 'POST', body: form })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
      throw new Error(err.error?.message || `HTTP ${res.status}`)
    }
    const { data } = await res.json()
    return (data || []) as Attachment[]
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
  async createLlmProvider(input: { id: string; name: string; kind: string; baseUrl?: string; apiKeySettingKey?: string }): Promise<LlmProviderSummary> {
    const { data } = await apiFetch('/llm/providers', { method: 'POST', body: JSON.stringify(input) })
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

  // AI 鐢诲浘 (Image Studio)
  image: {
    async listSessions(): Promise<ImageSessionSummary[]> {
      const { data } = await apiFetch('/image-sessions')
      return data
    },
    async createSession(opts: { title?: string; default_model?: string } = {}): Promise<ImageSessionSummary> {
      const { data } = await apiFetch('/image-sessions', { method: 'POST', body: JSON.stringify(opts) })
      return data
    },
    async renameSession(id: string, title: string): Promise<ImageSessionSummary> {
      const { data } = await apiFetch(`/image-sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) })
      return data
    },
    async deleteSession(id: string): Promise<void> {
      await apiFetch(`/image-sessions/${id}`, { method: 'DELETE' })
    },
    async listGenerations(sessionId: string): Promise<ImageGenerationRecord[]> {
      const { data } = await apiFetch(`/image-sessions/${sessionId}/generations`)
      return data
    },
    async listTemplates(category?: string) {
      const suffix = category && category !== '鍏ㄩ儴' ? `?category=${encodeURIComponent(category)}` : ''
      const { data } = await apiFetch(`/image-templates${suffix}`)
      return data
    },
    async generate(payload: ImageGeneratePayload): Promise<ImageGenerationRecord> {
      const { data } = await apiFetch('/images', { method: 'POST', body: JSON.stringify(payload) })
      return data
    },
  },

  articleIllustrations: {
    async listEligibleSkills(): Promise<EligibleImageSkillDto[]> { const { data } = await apiFetch('/article-illustrations/eligible-skills'); return data },
    async listRecoverable(): Promise<ArticleIllustrationJobDto[]> { const { data } = await apiFetch('/article-illustrations/recoverable'); return data },
    async get(id: string): Promise<ArticleIllustrationJobDto> { const { data } = await apiFetch(`/article-illustrations/${id}`); return data },
    async createPlan(payload: object): Promise<ArticleIllustrationJobDto> { const { data } = await apiFetch('/article-illustrations/plans', { method: 'POST', body: JSON.stringify(payload) }); return data },
    async updateScene(jobId: string, sceneId: string, patch: object): Promise<ArticleIllustrationSceneDto> { const { data } = await apiFetch(`/article-illustrations/${jobId}/scenes/${sceneId}`, { method: 'PATCH', body: JSON.stringify(patch) }); return data },
    async replaceScenes(jobId: string, scenes: object[]): Promise<ArticleIllustrationSceneDto[]> { const { data } = await apiFetch(`/article-illustrations/${jobId}/scenes`, { method: 'PUT', body: JSON.stringify({ scenes }) }); return data },
    async confirm(id: string): Promise<ArticleIllustrationJobDto> { const { data } = await apiFetch(`/article-illustrations/${id}/confirm`, { method: 'POST', body: '{}' }); return data },
    async retryScene(jobId: string, sceneId: string): Promise<ArticleIllustrationJobDto> { const { data } = await apiFetch(`/article-illustrations/${jobId}/scenes/${sceneId}/retry`, { method: 'POST', body: '{}' }); return data },
    async resume(id: string): Promise<ArticleIllustrationJobDto> { const { data } = await apiFetch(`/article-illustrations/${id}/resume`, { method: 'POST', body: '{}' }); return data },
    async exportMarkdown(id: string): Promise<string> { const { data } = await apiFetch(`/article-illustrations/${id}/export`); return data.markdown },
  },
  // Clipboard (Electron only, graceful fallback)
  async readClipboard(): Promise<string> {    if (isElectron()) return (window as any).bloomai.readClipboard()
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

const FONT_FAMILIES: Record<string, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  segoe: "'Segoe UI', sans-serif",
  arial: 'Arial, Helvetica, sans-serif',
  georgia: "Georgia, 'Times New Roman', serif",
}

export function applyFont(family: string, size: string) {
  const root = document.documentElement
  if (family && FONT_FAMILIES[family]) {
    root.style.setProperty('--font-ui', FONT_FAMILIES[family])
  } else {
    root.style.removeProperty('--font-ui')
  }
  if (size) {
    root.style.setProperty('--font-size-base', size)
  } else {
    root.style.removeProperty('--font-size-base')
  }
}