// Platform abstraction: switches between Electron IPC and direct HTTP fetch
// In Electron: window.bloomai exposes IPC bridge from preload
// In future web: uses fetch + SSE directly

import { API_BASE } from '@shared/constants'
import type { Attachment } from '@shared/attachments'
import type { CreateProjectInput, ProjectSummary, Session, SessionPage } from '@shared/schemas'
import type { ResearchClarificationInput, ResearchEventDto, ResearchRunDetailDto, ResearchRunDto, ResearchRunFilter, StartResearchInput } from '@shared/deepresearch/contracts'
import type { CapabilityDto, DraftDto, DraftPreview, DraftValidation, InspectedPackage, PackageDetail, PackageInstallInput, PackageSource, Page, PaginationInput, RuntimeError, RunAction, SkillArtifact, SkillInstallation, SkillPackage, SkillRun, SkillRunEvent, SkillRuntimeCapabilities, SkillVersion, VersionCandidate, SkillRunStatus, SkillDraftContent } from '@renderer/pages/Skills/skill-runtime.types'

const isElectron = () =>
  typeof window !== 'undefined' && !!window.bloomai

// API helpers

export class SkillRuntimeApiError extends Error implements RuntimeError {
  readonly code: string
  readonly status: number
  readonly requestId?: string
  readonly retryable?: boolean
  readonly details?: Record<string, unknown>

  constructor(input: { code: string; message: string; status: number; requestId?: string; retryable?: boolean; details?: Record<string, unknown> }) {
    super(input.message)
    this.name = 'SkillRuntimeApiError'
    this.code = input.code
    this.status = input.status
    this.requestId = input.requestId
    this.retryable = input.retryable
    this.details = input.details
  }
}

function normalizeRuntimeError(payload: unknown, status: number, fallbackMessage: string): SkillRuntimeApiError {
  const envelope = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const raw = envelope.error && typeof envelope.error === 'object' ? envelope.error as Record<string, unknown> : envelope
  return new SkillRuntimeApiError({
    code: typeof raw.code === 'string' ? raw.code : status === 0 ? 'NETWORK_ERROR' : `HTTP_${status}`,
    message: typeof raw.message === 'string' ? raw.message : fallbackMessage,
    status,
    requestId: typeof raw.requestId === 'string' ? raw.requestId : undefined,
    retryable: typeof raw.retryable === 'boolean' ? raw.retryable : status === 0 || status === 408 || status === 429 || status >= 500,
    details: raw.details && typeof raw.details === 'object' ? raw.details as Record<string, unknown> : undefined,
  })
}

export async function apiFetch(path: string, options?: RequestInit): Promise<any> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
  } catch (cause) {
    throw normalizeRuntimeError(null, 0, cause instanceof Error ? cause.message : 'Network request failed')
  }
  const payload = await res.json().catch(() => null)
  if (!res.ok) throw normalizeRuntimeError(payload, res.status, res.statusText || `HTTP ${res.status}`)
  // 204 No Content (e.g. DELETE) carries no body — calling res.json() would throw.
  if (res.status === 204) return null
  return payload
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function readValue<T>(row: Record<string, unknown>, camel: string, snake: string, fallback: T): T {
  const value = row[camel] ?? row[snake]
  return (value === undefined ? fallback : value) as T
}
function asBoolean(value: unknown): boolean { return value === true || value === 1 || value === '1' }
function asNumber(value: unknown, fallback = 0): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return asRecord(JSON.parse(value)) } catch { return {} }
  }
  return asRecord(value)
}

function toSkillPackage(value: unknown): SkillPackage {
  const row = asRecord(value)
  return {
    id: String(row.id ?? ''), name: String(row.name ?? ''), description: String(row.description ?? ''),
    sourceType: String(readValue(row, 'sourceType', 'source_type', '')), sourceUri: readValue(row, 'sourceUri', 'source_uri', null),
    sourceRef: readValue(row, 'sourceRef', 'source_ref', null), createdAt: asNumber(readValue(row, 'createdAt', 'created_at', 0)),
    updatedAt: asNumber(readValue(row, 'updatedAt', 'updated_at', 0)), deletedAt: readValue(row, 'deletedAt', 'deleted_at', null),
    deleteReason: readValue(row, 'deleteReason', 'delete_reason', null),
  }
}
function toSkillVersion(value: unknown): SkillVersion {
  const row = asRecord(value)
  return {
    id: String(row.id ?? ''), packageId: String(readValue(row, 'packageId', 'package_id', '')), version: String(row.version ?? ''),
    runtime: String(row.runtime ?? ''), manifest: asObject(readValue(row, 'manifest', 'manifest_json', {})),
    manifestHash: String(readValue(row, 'manifestHash', 'manifest_hash', '')), packagePath: String(readValue(row, 'packagePath', 'package_path', '')),
    sourceSnapshot: asObject(readValue(row, 'sourceSnapshot', 'source_snapshot_json', {})), isCompatible: asBoolean(readValue(row, 'isCompatible', 'is_compatible', false)),
    immutableHash: readValue(row, 'immutableHash', 'immutable_hash', undefined), status: typeof row.status === 'string' ? row.status : undefined,
    securityStatus: readValue(row, 'securityStatus', 'security_status', undefined), snapshotHash: readValue(row, 'snapshotHash', 'snapshot_hash', undefined),
    publishedAt: readValue(row, 'publishedAt', 'published_at', null), createdAt: asNumber(readValue(row, 'createdAt', 'created_at', 0)),
  }
}
function toInstallation(value: unknown): SkillInstallation {
  const row = asRecord(value)
  return {
    id: String(row.id ?? ''), packageId: String(readValue(row, 'packageId', 'package_id', '')), currentVersionId: String(readValue(row, 'currentVersionId', 'current_version_id', '')),
    status: String(row.status ?? ''), enabled: asBoolean(row.enabled), installedAt: asNumber(readValue(row, 'installedAt', 'installed_at', 0)),
    updatedAt: asNumber(readValue(row, 'updatedAt', 'updated_at', 0)), previousVersionId: readValue(row, 'previousVersionId', 'previous_version_id', null),
    revision: asNumber(row.revision), changedAt: readValue(row, 'changedAt', 'changed_at', null), disabledAt: readValue(row, 'disabledAt', 'disabled_at', null),
    uninstalledAt: readValue(row, 'uninstalledAt', 'uninstalled_at', null), deletedAt: readValue(row, 'deletedAt', 'deleted_at', null), rollbackReason: readValue(row, 'rollbackReason', 'rollback_reason', null),
  }
}
function toCapability(value: unknown): CapabilityDto {
  const row = asRecord(value)
  const scope = asObject(readValue(row, 'scope', 'scope_json', {}))
  return {
    id: String(row.id ?? ''),
    skillVersionId: String(readValue(row, 'skillVersionId', 'skill_version_id', '')), capability: String(row.capability ?? ''), scope,
    status: typeof row.status === 'string' ? row.status : undefined, grantMode: readValue(row, 'grantMode', 'grant_mode', undefined),
    grantedBy: readValue(row, 'grantedBy', 'granted_by', null), grantedAt: readValue(row, 'grantedAt', 'granted_at', null),
    expiresAt: readValue(row, 'expiresAt', 'expires_at', null), revokedAt: readValue(row, 'revokedAt', 'revoked_at', null), consumedAt: readValue(row, 'consumedAt', 'consumed_at', null),
    requestedScope: asObject(readValue(row, 'requestedScope', 'requested_scope_json', {})), grantedScope: asObject(readValue(row, 'grantedScope', 'granted_scope_json', {})),
    usage: row.usage && typeof row.usage === 'object' ? row.usage as CapabilityDto['usage'] : undefined,
  }
}
function toPackageDetail(value: unknown): PackageDetail {
  const row = asRecord(value)
  return {
    package: toSkillPackage(row.package), versions: Array.isArray(row.versions) ? row.versions.map(toSkillVersion) : [],
    installations: Array.isArray(row.installations) ? row.installations.map(toInstallation) : [],
    capabilityGrants: Array.isArray(row.capabilityGrants) ? row.capabilityGrants.map(toCapability) : [],
  }
}
function toSkillRun(value: unknown): SkillRun {
  const row = asRecord(value)
  const requiredActionValue = row.requiredAction ?? row.required_action
  return {
    id: String(row.id ?? ''), skillVersionId: String(readValue(row, 'skillVersionId', 'skill_version_id', '')), status: String(row.status ?? 'created') as SkillRun['status'],
    revision: asNumber(row.revision), input: asObject(row.input), output: row.output && typeof row.output === 'object' ? row.output as Record<string, unknown> : null,
    context: asObject(row.context), surface: typeof row.surface === 'string' ? row.surface : null, sessionId: readValue(row, 'sessionId', 'session_id', null),
    imageSessionId: readValue(row, 'imageSessionId', 'image_session_id', null), waitingReason: readValue(row, 'waitingReason', 'waiting_reason', null),
    waitingSince: readValue(row, 'waitingSince', 'waiting_since', null), waitingExpiresAt: readValue(row, 'waitingExpiresAt', 'waiting_expires_at', null),
    requiredAction: requiredActionValue && typeof requiredActionValue === 'object' ? asObject(requiredActionValue) : null,
    cancelRequested: asBoolean(readValue(row, 'cancelRequested', 'cancel_requested', false)), startedAt: readValue(row, 'startedAt', 'started_at', null),
    updatedAt: asNumber(readValue(row, 'updatedAt', 'updated_at', 0)), finishedAt: readValue(row, 'finishedAt', 'finished_at', null),
    errorCode: readValue(row, 'errorCode', 'error_code', null), errorMessage: readValue(row, 'errorMessage', 'error_message', null), resultSummary: readValue(row, 'resultSummary', 'result_summary', null),
  }
}
function toSkillRunEvent(value: unknown): SkillRunEvent {
  const row = asRecord(value)
  return {
    id: String(row.id ?? ''), runId: String(readValue(row, 'runId', 'run_id', '')), seq: asNumber(row.seq), schemaVersion: asNumber(readValue(row, 'schemaVersion', 'schema_version', 1), 1),
    producer: String(row.producer ?? ''), type: String(row.type ?? ''), payload: asObject(row.payload), occurredAt: asNumber(readValue(row, 'occurredAt', 'occurred_at', 0)), createdAt: asNumber(readValue(row, 'createdAt', 'created_at', 0)),
  }
}
function toSkillArtifact(value: unknown): SkillArtifact {
  const row = asRecord(value)
  return {
    id: String(row.id ?? ''), runId: String(readValue(row, 'runId', 'run_id', '')), kind: String(row.kind ?? ''), mimeType: readValue(row, 'mimeType', 'mime_type', null),
    path: String(row.path ?? ''), sizeBytes: asNumber(readValue(row, 'sizeBytes', 'size_bytes', 0)), sha256: String(row.sha256 ?? ''), metadata: asObject(readValue(row, 'metadata', 'metadata_json', {})),
    createdAt: asNumber(readValue(row, 'createdAt', 'created_at', 0)), retentionUntil: readValue(row, 'retentionUntil', 'retention_until', null), exportedAt: readValue(row, 'exportedAt', 'exported_at', null),
  }
}
function toDraft(value: unknown): DraftDto {
  const row = asRecord(value)
  return {
    id: String(row.id ?? ''), ownerId: typeof row.ownerId === 'string' ? row.ownerId : typeof row.owner_id === 'string' ? row.owner_id : undefined,
    content: asObject(row.content) as DraftDto['content'], baseVersionId: readValue(row, 'baseVersionId', 'base_version_id', null), revision: asNumber(row.revision),
    status: typeof row.status === 'string' ? row.status : undefined, createdAt: readValue(row, 'createdAt', 'created_at', undefined), updatedAt: readValue(row, 'updatedAt', 'updated_at', undefined),
  }
}
function page<T>(payload: { data?: unknown; meta?: unknown }, map: (value: unknown) => T): Page<T> {
  const meta = asRecord(payload.meta)
  const limit = asNumber(meta.limit, 20), offset = asNumber(meta.offset, 0), total = asNumber(meta.total, Array.isArray(payload.data) ? payload.data.length : 0)
  return { data: Array.isArray(payload.data) ? payload.data.map(map) : [], meta: { limit, offset, total, hasMore: typeof meta.hasMore === 'boolean' ? meta.hasMore : offset + limit < total, nextOffset: typeof meta.nextOffset === 'number' ? meta.nextOffset : null } }
}

export type LlmModality = 'text' | 'image' | 'video'
export type DeepResearchStatusDto = { enabled: boolean; version: 'v2' }
export type ArticleIllustrationSceneDto = { id: string; ordinal: number; title: string; excerpt: string; prompt: string; status: string; generation_id: string | null; error_message: string | null; retry_count: number }
export type ArticleIllustrationJobDto = { id: string; source_type: 'text' | 'url' | 'file'; source_label: string; source_url: string | null; article_text: string; mode: 'skill' | 'fallback'; skill_version_id: string | null; run_id: string | null; image_session_id: string | null; config: Record<string, unknown>; status: string; error_message: string | null; scenes: ArticleIllustrationSceneDto[] }
export type EligibleImageSkillDto = { packageId: string; packageName: string; skillVersionId: string; version: string; requiredCapabilities: string[]; activeImageGrant: { grantMode: string; maxCalls: number | null; allowedModels: string[] | null } | null }

export type ChatSkillReferenceDto = {
  packageId: string
  packageName: string
  description: string
  skillVersionId: string
  version: string
  requiredCapabilities: string[]
}

export type SkillRunDto = SkillRun
export type SkillRunEventDto = SkillRunEvent
export type SkillRuntimeCapabilitiesDto = SkillRuntimeCapabilities

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
  async getSkillRuntimeCapabilities(): Promise<SkillRuntimeCapabilitiesDto> {
    const { data } = await apiFetch('/skill-runtime/capabilities')
    return data
  },
  async listChatEligibleSkills(sessionId: string): Promise<ChatSkillReferenceDto[]> {
    const { data } = await apiFetch(`/chat/sessions/${encodeURIComponent(sessionId)}/skills`)
    return data
  },
  async startChatSkillRun(input: {
    sessionId: string
    skillVersionId: string
    input: Record<string, unknown>
    idempotencyKey: string
    userMessage?: { content: string; parts?: unknown[] }
  }): Promise<{ runId: string; skillVersionId: string; status: string; sessionId: string; revision: number; created: boolean }> {
    const { data } = await apiFetch(`/chat/sessions/${encodeURIComponent(input.sessionId)}/skill-runs`, {
      method: 'POST',
      body: JSON.stringify({
        skillVersionId: input.skillVersionId,
        input: input.input,
        idempotencyKey: input.idempotencyKey,
        userMessage: input.userMessage,
      }),
    })
    return data
  },
  async getSkillRun(runId: string): Promise<SkillRunDto> {
    const { data } = await apiFetch(`/skill-runs/${encodeURIComponent(runId)}`)
    return toSkillRun(data)
  },
  async listSkillRunEvents(runId: string, afterSeq = 0): Promise<SkillRunEventDto[]> {
    const { data } = await apiFetch(`/skill-runs/${encodeURIComponent(runId)}/events?afterSeq=${encodeURIComponent(String(afterSeq))}`)
    return Array.isArray(data) ? data.map(toSkillRunEvent) : []
  },
  async getSkillPackages(input: PaginationInput = {}): Promise<Page<SkillPackage>> {
    const limit = input.limit ?? 20, offset = input.offset ?? 0
    return page(await apiFetch(`/skill-packages?limit=${limit}&offset=${offset}`), toSkillPackage)
  },
  async getSkillInstallations(input: PaginationInput = {}): Promise<Page<SkillInstallation>> {
    const limit = input.limit ?? 20, offset = input.offset ?? 0
    return page(await apiFetch(`/skill-installations?limit=${limit}&offset=${offset}`), toInstallation)
  },
  async getSkillPackage(packageId: string): Promise<PackageDetail> {
    const { data } = await apiFetch(`/skill-packages/${encodeURIComponent(packageId)}`)
    return toPackageDetail(data)
  },
  async getSkillVersions(packageId: string): Promise<SkillVersion[]> {
    const { data } = await apiFetch(`/skill-packages/${encodeURIComponent(packageId)}/versions`)
    return Array.isArray(data) ? data.map(toSkillVersion) : []
  },
  async getSkillVersion(versionId: string): Promise<SkillVersion> {
    const { data } = await apiFetch(`/skill-versions/${encodeURIComponent(versionId)}`)
    return toSkillVersion(data)
  },
  async diffSkillVersions(fromVersionId: string, toVersionId: string): Promise<Record<string, unknown>> {
    const { data } = await apiFetch(`/skill-versions/${encodeURIComponent(fromVersionId)}/diff?toVersionId=${encodeURIComponent(toVersionId)}`)
    return asObject(data)
  },
  async inspectSkillPackage(source: PackageSource): Promise<InspectedPackage[]> {
    const { data } = await apiFetch('/skill-packages/inspect', { method: 'POST', body: JSON.stringify({ source }) })
    return Array.isArray(data) ? data as InspectedPackage[] : []
  },
  async installSkillPackage(input: PackageInstallInput): Promise<PackageDetail | Record<string, unknown>> {
    const { data } = await apiFetch('/skill-packages/install', { method: 'POST', body: JSON.stringify(input) })
    return data && typeof data === 'object' && 'package' in (data as Record<string, unknown>) ? toPackageDetail(data) : asObject(data)
  },
  async previewSkillVersionUpdate(packageId: string, candidate: VersionCandidate): Promise<Record<string, unknown>> {
    const { data } = await apiFetch(`/skill-packages/${encodeURIComponent(packageId)}/update/preview`, { method: 'POST', body: JSON.stringify(candidate) })
    return asObject(data)
  },
  async updateSkillPackage(packageId: string, candidate: VersionCandidate): Promise<SkillVersion> {
    const { data } = await apiFetch(`/skill-packages/${encodeURIComponent(packageId)}/update`, { method: 'POST', body: JSON.stringify({ ...candidate, confirm: true }) })
    return toSkillVersion(data)
  },
  async enableSkillInstallation(installationId: string, input: { expectedRevision: number; idempotencyKey: string }): Promise<SkillInstallation> {
    const { data } = await apiFetch(`/skill-installations/${encodeURIComponent(installationId)}`, { method: 'PATCH', body: JSON.stringify({ ...input, enabled: true }) })
    return toInstallation(data)
  },
  async disableSkillInstallation(installationId: string, input: { expectedRevision: number; idempotencyKey: string }): Promise<SkillInstallation> {
    const { data } = await apiFetch(`/skill-installations/${encodeURIComponent(installationId)}`, { method: 'PATCH', body: JSON.stringify({ ...input, enabled: false }) })
    return toInstallation(data)
  },
  async switchSkillInstallationVersion(installationId: string, input: { versionId: string; expectedRevision: number; idempotencyKey: string }): Promise<SkillInstallation> {
    const { data } = await apiFetch(`/skill-installations/${encodeURIComponent(installationId)}/switch-version`, { method: 'POST', body: JSON.stringify(input) })
    return toInstallation(data)
  },
  async rollbackSkillInstallation(installationId: string, input: { versionId?: string; expectedRevision: number; idempotencyKey: string; reason: string }): Promise<SkillInstallation> {
    const { data } = await apiFetch(`/skill-installations/${encodeURIComponent(installationId)}/rollback`, { method: 'POST', body: JSON.stringify(input) })
    return toInstallation(data)
  },
  async uninstallSkillInstallation(installationId: string, input: { expectedRevision: number; idempotencyKey: string }): Promise<SkillInstallation> {
    const { data } = await apiFetch(`/skill-installations/${encodeURIComponent(installationId)}`, { method: 'DELETE', body: JSON.stringify(input) })
    const record = asRecord(data)
    return toInstallation(record.installation ?? data)
  },
  async deleteSkillPackage(packageId: string, input: { reason: string; idempotencyKey: string }): Promise<Record<string, unknown>> {
    const { data } = await apiFetch(`/skill-packages/${encodeURIComponent(packageId)}`, { method: 'DELETE', body: JSON.stringify({ ...input, confirm: true }) })
    return asObject(data)
  },
  async listSkillRuns(input: PaginationInput & { status?: SkillRunStatus; skillVersionId?: string } = {}): Promise<Page<SkillRun>> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 20), offset: String(input.offset ?? 0) })
    if (input.status) query.set('status', input.status)
    if (input.skillVersionId) query.set('skillVersionId', input.skillVersionId)
    return page(await apiFetch(`/skill-runs?${query.toString()}`), toSkillRun)
  },
  async createSkillRun(input: { skillId?: string; skillVersionId?: string; input: Record<string, unknown>; context?: Record<string, unknown>; surface?: 'skills' | 'chat' | 'image'; sessionId?: string; imageSessionId?: string; target?: { kind: 'chat' | 'image_session' | 'artifact_only'; id?: string } }): Promise<SkillRun> {
    const { data } = await apiFetch('/skill-runs', { method: 'POST', body: JSON.stringify(input) })
    return toSkillRun(data)
  },
  async getSkillRunNextAction(runId: string): Promise<Record<string, unknown> | null> {
    const { data } = await apiFetch(`/skill-runs/${encodeURIComponent(runId)}/next-action`)
    return data && typeof data === 'object' ? data as Record<string, unknown> : null
  },
  async getSkillRunCapabilities(runId: string): Promise<CapabilityDto[]> {
    const { data } = await apiFetch(`/skill-runs/${encodeURIComponent(runId)}/capabilities`)
    return Array.isArray(data) ? data.map(toCapability) : []
  },
  skillRunEventsStreamUrl(runId: string, afterSeq = 0): string {
    return `${API_BASE}/skill-runs/${encodeURIComponent(runId)}/stream?afterSeq=${encodeURIComponent(String(afterSeq))}`
  },
  subscribeSkillRunEvents(runId: string, afterSeq: number, handlers: { onEvent?: (event: SkillRunEvent) => void; onError?: (error: RuntimeError) => void } = {}): { close: () => void } {
    if (typeof EventSource === 'undefined') throw new SkillRuntimeApiError({ code: 'STREAM_UNAVAILABLE', message: 'EventSource is unavailable', status: 0, retryable: true })
    const source = new EventSource(this.skillRunEventsStreamUrl(runId, afterSeq))
    source.onmessage = (message) => { try { handlers.onEvent?.(toSkillRunEvent(JSON.parse(message.data) as unknown)) } catch (error) { handlers.onError?.(normalizeRuntimeError(null, 0, error instanceof Error ? error.message : 'Invalid event payload')) } }
    source.onerror = () => handlers.onError?.(normalizeRuntimeError(null, 0, 'Skill Run event stream disconnected'))
    return { close: () => source.close() }
  },
  async dispatchSkillRunCommand(runId: string, action: RunAction): Promise<SkillRun> {
    const { data } = await apiFetch(`/skill-runs/${encodeURIComponent(runId)}/commands`, { method: 'POST', body: JSON.stringify(action) })
    return toSkillRun(data)
  },
  async cancelSkillRun(runId: string, input: { expectedRevision: number; idempotencyKey: string; reason?: string }): Promise<SkillRun> {
    const { data } = await apiFetch(`/skill-runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', body: JSON.stringify(input) })
    return toSkillRun(data)
  },
  async listSkillArtifacts(runId: string, input: PaginationInput & { sort?: 'createdAt' | 'size' | 'kind'; direction?: 'asc' | 'desc' } = {}): Promise<Page<SkillArtifact>> {
    const query = new URLSearchParams()
    if (input.limit !== undefined) query.set('limit', String(input.limit))
    if (input.offset !== undefined) query.set('offset', String(input.offset))
    if (input.sort) query.set('sort', input.sort)
    if (input.direction) query.set('direction', input.direction)
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return page(await apiFetch(`/skill-runs/${encodeURIComponent(runId)}/artifacts${suffix}`), toSkillArtifact)
  },
  skillArtifactContentUrl(artifactId: string, runId: string): string {
    return `${API_BASE}/skill-artifacts/${encodeURIComponent(artifactId)}/content?runId=${encodeURIComponent(runId)}`
  },
  async getSkillArtifactContent(artifactId: string, runId: string): Promise<Blob> {
    let response: Response
    try { response = await fetch(this.skillArtifactContentUrl(artifactId, runId)) } catch (cause) { throw normalizeRuntimeError(null, 0, cause instanceof Error ? cause.message : 'Network request failed') }
    if (!response.ok) throw normalizeRuntimeError(await response.json().catch(() => null), response.status, response.statusText || `HTTP ${response.status}`)
    return response.blob()
  },
  async exportSkillArtifact(artifactId: string, input: { runId: string; destinationDir: string; confirmed: true; actor?: string; auditReason: string }): Promise<{ path: string }> {
    const { data } = await apiFetch(`/skill-artifacts/${encodeURIComponent(artifactId)}/export`, { method: 'POST', body: JSON.stringify(input) })
    return { path: String(asRecord(data).path ?? '') }
  },
  async approveCapabilityGrant(grantId: string, input: { actor: string; scope?: Record<string, unknown>; expiresAt?: number | null }): Promise<CapabilityDto> {
    const { data } = await apiFetch(`/skill-capability-grants/${encodeURIComponent(grantId)}/approve`, { method: 'POST', body: JSON.stringify(input) })
    return toCapability(data)
  },
  async rejectCapabilityGrant(grantId: string, input: { actor: string; reason?: string }): Promise<CapabilityDto> {
    const { data } = await apiFetch(`/skill-capability-grants/${encodeURIComponent(grantId)}/reject`, { method: 'POST', body: JSON.stringify(input) })
    return toCapability(data)
  },
  async revokeCapabilityGrant(grantId: string, input?: { actor: string; reason?: string }): Promise<CapabilityDto | Record<string, unknown>> {
    const { data } = await apiFetch(`/skill-capability-grants/${encodeURIComponent(grantId)}/revoke`, { method: 'POST', body: JSON.stringify(input ?? { actor: 'local-user' }) })
    return data && typeof data === 'object' ? toCapability(data) : asObject(data)
  },
  async getImportReview(reviewId: string): Promise<Record<string, unknown>> {
    const { data } = await apiFetch(`/skill-import-reviews/${encodeURIComponent(reviewId)}`)
    return asObject(data)
  },
  async approveImportReview(reviewId: string, reviewer: string): Promise<Record<string, unknown>> {
    const { data } = await apiFetch(`/skill-import-reviews/${encodeURIComponent(reviewId)}/approve`, { method: 'POST', body: JSON.stringify({ reviewer }) })
    return asObject(data)
  },
  async rejectImportReview(reviewId: string, reviewer: string, reason?: string): Promise<Record<string, unknown>> {
    const { data } = await apiFetch(`/skill-import-reviews/${encodeURIComponent(reviewId)}/reject`, { method: 'POST', body: JSON.stringify({ reviewer, reason }) })
    return asObject(data)
  },
  async createSkillDraft(input: { content: SkillDraftContent; baseVersionId?: string }): Promise<DraftDto> {
    const { data } = await apiFetch('/skill-drafts', { method: 'POST', body: JSON.stringify(input) })
    return toDraft(data)
  },
  async getSkillDraft(draftId: string): Promise<DraftDto> {
    const { data } = await apiFetch(`/skill-drafts/${encodeURIComponent(draftId)}`)
    return toDraft(data)
  },
  async updateSkillDraft(draftId: string, input: { expectedRevision: number; patch: Partial<SkillDraftContent> }): Promise<DraftDto> {
    const { data } = await apiFetch(`/skill-drafts/${encodeURIComponent(draftId)}`, { method: 'PATCH', body: JSON.stringify(input) })
    return toDraft(data)
  },
  async discardSkillDraft(draftId: string): Promise<DraftDto> {
    const { data } = await apiFetch(`/skill-drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' })
    return toDraft(data)
  },
  async validateSkillDraft(draftId: string): Promise<DraftValidation> {
    const { data } = await apiFetch(`/skill-drafts/${encodeURIComponent(draftId)}/validate`, { method: 'POST', body: '{}' })
    return data as DraftValidation
  },
  async previewSkillDraft(draftId: string): Promise<DraftPreview> {
    const { data } = await apiFetch(`/skill-drafts/${encodeURIComponent(draftId)}/preview`, { method: 'POST', body: '{}' })
    return data as DraftPreview
  },
  async publishSkillDraft(draftId: string, input: { enable?: boolean } = {}): Promise<Record<string, unknown>> {
    const { data } = await apiFetch(`/skill-drafts/${encodeURIComponent(draftId)}/publish`, { method: 'POST', body: JSON.stringify(input) })
    return asObject(data)
  },
  // Sessions
  async getSessions() {
    const { data } = await apiFetch('/sessions')
    return data
  },
  async createSession(opts: { title?: string; persona_id?: string; model?: string } = {}) {
    const { data } = await apiFetch('/sessions', { method: 'POST', body: JSON.stringify(opts) })
    return data
  },
  async getProjects(): Promise<ProjectSummary[]> {
    const { data } = await apiFetch('/projects')
    return data
  },
  async createProject(input: CreateProjectInput): Promise<{ project: ProjectSummary; initialSession: Session }> {
    const { data } = await apiFetch('/projects', { method: 'POST', body: JSON.stringify(input) })
    return data
  },
  async getProjectSessions(projectId: string, page: { limit: number; offset: number }): Promise<SessionPage> {
    const { data, meta } = await apiFetch(`/projects/${encodeURIComponent(projectId)}/sessions?limit=${encodeURIComponent(String(page.limit))}&offset=${encodeURIComponent(String(page.offset))}`)
    return { data, meta }
  },
  async createProjectSession(projectId: string, input: { title?: string; persona_id?: string; model?: string } = {}): Promise<Session> {
    const { data } = await apiFetch(`/projects/${encodeURIComponent(projectId)}/sessions`, { method: 'POST', body: JSON.stringify(input) })
    return data
  },
  async getRecentSessions(page: { limit: number; offset: number }): Promise<SessionPage> {
    const { data, meta } = await apiFetch(`/sessions?scope=recent&limit=${encodeURIComponent(String(page.limit))}&offset=${encodeURIComponent(String(page.offset))}`)
    return { data, meta }
  },
  async selectDirectory(): Promise<{ canceled: boolean; path?: string }> {
    if (!isElectron() || !window.bloomai?.selectDirectory) return { canceled: true }
    return window.bloomai.selectDirectory()
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

  deepResearch: {
    async getStatus(): Promise<DeepResearchStatusDto> {
      try {
        const { data } = await apiFetch('/deep-research/status')
        return data
      } catch (error) {
        if ((error as Error & { status?: number }).status === 404) return { enabled: false, version: 'v2' }
        throw error
      }
    },
    async start(input: StartResearchInput): Promise<ResearchRunDto> {
      const { data } = await apiFetch('/deep-research/runs', { method: 'POST', body: JSON.stringify(input) })
      return data
    },
    async list(filter: ResearchRunFilter = {}): Promise<ResearchRunDto[]> {
      const query = new URLSearchParams()
      if (filter.sessionId) query.set('sessionId', filter.sessionId)
      if (filter.statuses?.length) query.set('statuses', filter.statuses.join(','))
      if (filter.profile) query.set('profile', filter.profile)
      if (filter.limit !== undefined) query.set('limit', String(filter.limit))
      if (filter.cursor) query.set('cursor', filter.cursor)
      const suffix = query.size ? '?' + query.toString() : ''
      const { data } = await apiFetch('/deep-research/runs' + suffix)
      return data
    },
    async get(runId: string): Promise<ResearchRunDetailDto> {
      const { data } = await apiFetch('/deep-research/runs/' + encodeURIComponent(runId))
      return data
    },
    async listEvents(runId: string, after = 0): Promise<ResearchEventDto[]> {
      const { data } = await apiFetch('/deep-research/runs/' + encodeURIComponent(runId) + '/events?after=' + encodeURIComponent(String(after)))
      return data
    },
    async answerClarification(runId: string, input: ResearchClarificationInput): Promise<ResearchRunDto> {
      const { data } = await apiFetch('/deep-research/runs/' + encodeURIComponent(runId) + '/clarifications', { method: 'POST', body: JSON.stringify(input) })
      return data
    },
    async cancel(runId: string): Promise<ResearchRunDto> {
      const { data } = await apiFetch('/deep-research/runs/' + encodeURIComponent(runId) + '/cancel', { method: 'POST', body: '{}' })
      return data
    },
    async resume(runId: string): Promise<ResearchRunDto> {
      const { data } = await apiFetch('/deep-research/runs/' + encodeURIComponent(runId) + '/resume', { method: 'POST', body: '{}' })
      return data
    },
    streamUrl(runId: string, after = 0): string {
      return API_BASE + '/deep-research/runs/' + encodeURIComponent(runId) + '/stream?after=' + encodeURIComponent(String(after))
    },
    artifactUrl(runId: string, artifactId: string): string {
      return API_BASE + '/deep-research/runs/' + encodeURIComponent(runId) + '/artifacts/' + encodeURIComponent(artifactId)
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
  async readClipboard(): Promise<string> {    if (isElectron() && window.bloomai) return window.bloomai.readClipboard()
    try { return await navigator.clipboard.readText() } catch { return '' }
  },

  // Active window (Electron only)
  async getActiveWindow(): Promise<string> {
    if (isElectron() && window.bloomai) return window.bloomai.getActiveWindow()
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