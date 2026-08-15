// Platform abstraction: switches between Electron IPC and direct HTTP fetch
// In Electron: window.bloomai exposes IPC bridge from preload
// In future web: uses fetch + SSE directly

import { API_BASE } from '@shared/constants'
import type { Attachment } from '@shared/attachments'
import type { CreateProjectInput, ProjectSummary, Session, SessionPage } from '@shared/schemas'
import type { ResearchClarificationInput, ResearchEventDto, ResearchRunDetailDto, ResearchRunDto, ResearchRunFilter, StartResearchInput } from '@shared/deepresearch/contracts'
import type { CapabilityDto, DraftDto, DraftPreview, DraftValidation, DraftListInput, InspectedPackage, PackageDetail, PackageImportDiagnostic, PackageImportReview, PackageInspectionResult, PackageInstallInput, PackageListInput, PackageSource, Page, PaginationInput, RuntimeError, RunAction, RunCapabilityCall, SkillArtifact, SkillInstallation, SkillPackage, SkillRun, SkillRunEvent, SkillRuntimeCapabilities, SkillRuntimeDiagnosticsSnapshot, SkillRuntimeFeatureFlags, SkillRuntimeSettings, SkillVersion, VersionCandidate, SkillRunStatus, SkillDraftContent, CreatorPublishResult } from '@renderer/pages/Skills/skill-runtime.types'
import { normalizeCreatorPublishResult, normalizeSkillDraftContent } from '@renderer/pages/Skills/skill-runtime.types'

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
function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}
function asStringArray(value: unknown): string[] { return asArray(value).filter((item): item is string => typeof item === 'string') }
function asNumberRecord(value: unknown): Record<string, number> {
  const record = asObject(value)
  return Object.fromEntries(Object.entries(record).filter(([, item]) => typeof item === 'number' && Number.isFinite(item)).map(([key, item]) => [key, item as number]))
}
function toPackageManifest(value: unknown): InspectedPackage['manifest'] {
  const row = asRecord(value)
  const requested = asArray(readValue(row, 'requestedCapabilities', 'requested_capabilities', [])).map((item) => {
    const capability = asRecord(item)
    return { capability: String(capability.capability ?? ''), scope: asObject(readValue(capability, 'scope', 'scope_json', {})) }
  })
  return {
    name: String(row.name ?? ''), description: String(row.description ?? ''), runtime: String(row.runtime ?? ''), entryPath: String(readValue(row, 'entryPath', 'entry_path', '')),
    compatible: asBoolean(row.compatible), requestedCapabilities: requested, recommendedSurface: readValue(row, 'recommendedSurface', 'recommended_surface', undefined),
    outputArtifactTypes: asStringArray(readValue(row, 'outputArtifactTypes', 'output_artifact_types', [])), references: asStringArray(row.references), assets: asStringArray(row.assets), scripts: asStringArray(row.scripts), unsupported: asStringArray(row.unsupported), unknownFrontmatter: asObject(readValue(row, 'unknownFrontmatter', 'unknown_frontmatter', {})),
    files: asArray(row.files).map((item) => { const file = asRecord(item); return { path: String(file.path ?? ''), sha256: String(file.sha256 ?? ''), sizeBytes: asNumber(readValue(file, 'sizeBytes', 'size_bytes', 0)) } }),
  }
}
function toPackageImportDiagnostic(value: unknown): PackageImportDiagnostic {
  const row = asRecord(value)
  return {
    code: typeof row.code === 'string' ? row.code : undefined,
    severity: String(row.severity ?? row.level ?? 'info'),
    message: String(row.message ?? row.detail ?? ''),
    path: typeof row.path === 'string' ? row.path : undefined,
    line: typeof row.line === 'number' ? row.line : undefined,
    column: typeof row.column === 'number' ? row.column : undefined,
    details: row.details && typeof row.details === 'object' ? asObject(row.details) : undefined,
  }
}
function toInspectedPackage(value: unknown): InspectedPackage {
  const row = asRecord(value)
  const snapshot = asObject(readValue(row, 'sourceSnapshot', 'source_snapshot', {}))
  return {
    sourceType: String(readValue(row, 'sourceType', 'source_type', '')),
    relativeSkillPath: String(readValue(row, 'relativeSkillPath', 'relative_skill_path', '')),
    manifestHash: String(readValue(row, 'manifestHash', 'manifest_hash', '')),
    sourceFingerprint: String(readValue(row, 'sourceFingerprint', 'source_fingerprint', readValue(snapshot, 'sourceSha256', 'source_sha256', ''))),
    diagnostics: asArray(readValue(row, 'diagnostics', 'diagnostics', [])).map(toPackageImportDiagnostic),
    importReviewRequired: asBoolean(readValue(row, 'importReviewRequired', 'import_review_required', false)),
    manifest: toPackageManifest(row.manifest),
    sourceSnapshot: {
      sourceSha256: String(readValue(snapshot, 'sourceSha256', 'source_sha256', '')),
      sourceCommit: readValue(snapshot, 'sourceCommit', 'source_commit', undefined),
      sourceRef: readValue(snapshot, 'sourceRef', 'source_ref', undefined),
      sourceOrigin: readValue(snapshot, 'sourceOrigin', 'source_origin', undefined),
      detectedLayout: readValue(snapshot, 'detectedLayout', 'detected_layout', undefined),
      ignoredPaths: asStringArray(readValue(snapshot, 'ignoredPaths', 'ignored_paths', [])),
      executionDisclaimer: readValue(snapshot, 'executionDisclaimer', 'execution_disclaimer', undefined),
      files: asArray(snapshot.files).map((item) => { const file = asRecord(item); return { path: String(file.path ?? ''), sha256: String(file.sha256 ?? ''), sizeBytes: asNumber(readValue(file, 'sizeBytes', 'size_bytes', 0)) } }),
    },
  }
}
function toPackageInspectionResult(value: unknown): PackageInspectionResult {
  if (Array.isArray(value)) {
    const packages = value.map(toInspectedPackage)
    return { reviewId: '', sourceFingerprint: packages[0]?.sourceFingerprint || packages[0]?.sourceSnapshot.sourceSha256 || '', packages }
  }
  const row = asRecord(value)
  const packages = asArray(row.packages).map(toInspectedPackage)
  return {
    reviewId: String(readValue(row, 'reviewId', 'review_id', '')),
    sourceFingerprint: String(readValue(row, 'sourceFingerprint', 'source_fingerprint', packages[0]?.sourceFingerprint || packages[0]?.sourceSnapshot.sourceSha256 || '')),
    resolvedCommitSha: readValue(row, 'resolvedCommitSha', 'resolved_commit_sha', undefined),
    packages,
  }
}
function toPackageImportReview(value: unknown): PackageImportReview {
  const row = asRecord(value)
  return {
    id: String(row.id ?? ''),
    source: String(row.source ?? row.source_type ?? ''),
    sourceSha: String(readValue(row, 'sourceSha', 'source_sha', '')),
    sourceRef: (readValue(row, 'sourceRef', 'source_ref', null) as string | null) ?? null,
    inspection: asObject(row.inspection),
    securityFindings: asObject(readValue(row, 'securityFindings', 'security_findings', {})),
    status: String(row.status ?? 'scanning'),
    reviewer: (row.reviewer as string | null | undefined) ?? null,
    decision: row.decision && typeof row.decision === 'object' ? asObject(row.decision) : null,
    createdAt: asNumber(readValue(row, 'createdAt', 'created_at', 0)),
    updatedAt: asNumber(readValue(row, 'updatedAt', 'updated_at', 0)),
  }
}
function toSkillRuntimeCapabilities(value: unknown): SkillRuntimeCapabilities {
  const row = asRecord(value)
  const sourcePolicy = asObject(readValue(row, 'sourcePolicy', 'source_policy', {}))
  const capabilityPolicy = asObject(readValue(row, 'capabilityPolicy', 'capability_policy', {}))
  const limits = asNumberRecord(row.limits)
  return {
    operationalStatus: String(readValue(row, 'operationalStatus', 'operational_status', 'disabled')) as SkillRuntimeCapabilities['operationalStatus'],
    statusReason: String(readValue(row, 'statusReason', 'status_reason', 'runtime_disabled')),
    canManage: asBoolean(readValue(row, 'canManage', 'can_manage', false)), canExecute: asBoolean(readValue(row, 'canExecute', 'can_execute', false)),
    sourcePolicy: { allowedKinds: asStringArray(readValue(sourcePolicy, 'allowedKinds', 'allowed_kinds', [])) },
    capabilityPolicy: { allowedCapabilities: asStringArray(readValue(capabilityPolicy, 'allowedCapabilities', 'allowed_capabilities', [])) },
    protocolVersion: String(readValue(row, 'protocolVersion', 'protocol_version', '')), configVersion: String(readValue(row, 'configVersion', 'config_version', '')),
    runtimeEnabled: asBoolean(readValue(row, 'runtimeEnabled', 'runtime_enabled', false)), packageExecutionEnabled: asBoolean(readValue(row, 'packageExecutionEnabled', 'package_execution_enabled', false)), importEnabled: asBoolean(readValue(row, 'importEnabled', 'import_enabled', false)), githubImportEnabled: asBoolean(readValue(row, 'githubImportEnabled', 'github_import_enabled', false)), npxImportEnabled: asBoolean(readValue(row, 'npxImportEnabled', 'npx_import_enabled', false)), creatorEnabled: asBoolean(readValue(row, 'creatorEnabled', 'creator_enabled', false)), creatorPublishEnabled: asBoolean(readValue(row, 'creatorPublishEnabled', 'creator_publish_enabled', false)), limits,
  }
}
function toSkillRuntimeDiagnostics(value: unknown): SkillRuntimeDiagnosticsSnapshot {
  const row = asRecord(value)
  const health = asRecord(row.health), worker = asRecord(row.worker), queue = asRecord(row.queue), migration = asRecord(row.migration), policy = asRecord(row.policy)
  const metrics = row.metrics && typeof row.metrics === 'object' ? asRecord(row.metrics) : undefined
  const result = {
    generatedAt: readValue(row, 'generatedAt', 'generated_at', undefined),
    health: { liveness: asBoolean(health.liveness), readiness: asBoolean(health.readiness), status: String(health.status ?? 'disabled'), availability: typeof health.availability === 'string' ? health.availability : undefined, legacyStatus: typeof health.legacyStatus === 'string' ? health.legacyStatus : typeof health.legacy_status === 'string' ? health.legacy_status : undefined, checks: asArray(health.checks).map((item) => { const check = asRecord(item); return { name: String(check.name ?? ''), status: String(check.status ?? 'warning'), message: typeof check.message === 'string' ? check.message : undefined } }) },
    worker: { status: String(worker.status ?? 'unknown'), workerId: readValue(worker, 'workerId', 'worker_id', null), heartbeatAt: readValue(worker, 'heartbeatAt', 'heartbeat_at', undefined), activeRuns: readValue(worker, 'activeRuns', 'active_runs', undefined), concurrency: readValue(worker, 'concurrency', 'concurrency', undefined) },
    queue: { depth: asNumber(queue.depth), queued: asNumber(queue.queued), leased: asNumber(queue.leased), retryWait: asNumber(readValue(queue, 'retryWait', 'retry_wait', 0)), dead: asNumber(queue.dead), lagMs: asNumber(readValue(queue, 'lagMs', 'lag_ms', 0)) },
    migration: { current: readValue(migration, 'current', 'current_migration', null), applied: asStringArray(migration.applied), pending: asStringArray(migration.pending) }, policy: { version: String(policy.version ?? ''), configVersion: String(readValue(policy, 'configVersion', 'config_version', '')) },
    recentFailures: asArray(readValue(row, 'recentFailures', 'recent_failures', [])).map((item) => { const failure = asRecord(item); return { runId: readValue(failure, 'runId', 'run_id', undefined), status: readValue(failure, 'status', 'status', undefined), errorCode: readValue(failure, 'errorCode', 'error_code', null), errorMessage: readValue(failure, 'errorMessage', 'error_message', null), updatedAt: readValue(failure, 'updatedAt', 'updated_at', undefined) } }),
    metrics: metrics ? { generatedAt: readValue(metrics, 'generatedAt', 'generated_at', undefined), retentionMs: readValue(metrics, 'retentionMs', 'retention_ms', undefined), counters: asObject(metrics.counters) as SkillRuntimeDiagnosticsSnapshot['metrics'] extends infer M ? M extends { counters?: infer C } ? C : never : never } : undefined,
  }
  return JSON.parse(JSON.stringify(result)) as SkillRuntimeDiagnosticsSnapshot
}
function toRuntimeSettings(value: unknown): SkillRuntimeSettings {
  const row = asObject(value)
  return { ...row, import: asObject(row.import), security: asObject(row.security), artifacts: asObject(row.artifacts), runtime: asObject(row.runtime), updatedAt: readValue(row, 'updatedAt', 'updated_at', undefined), revision: asNumber(row.revision, undefined as unknown as number) }
}
function toFeatureFlags(value: unknown): SkillRuntimeFeatureFlags { return { ...Object.fromEntries(Object.entries(asObject(value)).map(([key, item]) => [key, asBoolean(item)])) } as SkillRuntimeFeatureFlags }
function toDraftValidation(value: unknown): DraftValidation { const row = asRecord(value); const map = (items: unknown) => asArray(items).map((item) => { const issue = asRecord(item); return { path: readValue(issue, 'path', 'path', undefined), file: readValue(issue, 'file', 'file', undefined), line: readValue(issue, 'line', 'line', undefined), column: readValue(issue, 'column', 'column', undefined), message: String(issue.message ?? ''), code: readValue(issue, 'code', 'code', undefined) } }); return { valid: asBoolean(row.valid), errors: map(row.errors), warnings: map(row.warnings) } }
function toDraftPreview(value: unknown): DraftPreview { const row = asRecord(value); return { draft: toDraft(row.draft), validation: toDraftValidation(row.validation), immutableVersion: row.immutableVersion ? asObject(row.immutableVersion) as DraftPreview['immutableVersion'] : undefined, capabilityRisks: asArray(row.capabilityRisks ?? row.capability_risks).map((item) => { const risk = asRecord(item); return { capability: String(risk.capability ?? ''), scope: asObject(risk.scope), severity: String(risk.severity ?? 'unknown') } }) } }

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
const SKILL_RUN_EVENT_TYPES = [
  'package.loaded', 'package.file_loaded', 'input.summarized', 'step.started', 'step.completed',
  'capability.requested', 'capability.approval_required', 'capability.started', 'capability.completed',
  'capability.failed', 'capability.call', 'approval.required', 'artifact.created', 'run.started',
  'run.status_changed', 'run.waiting', 'run.resumed', 'run.interrupted', 'run.completed',
  'run.completed_with_errors', 'run.cancel_requested', 'run.cancelled', 'run.failed', 'ready',
] as const

function toSkillRun(value: unknown): SkillRun {
  const row = asRecord(value)
  const requiredActionValue = readValue(row, 'requiredAction', 'required_action_json', row.required_action)
  const versionValue = readValue(row, 'version', 'version_json', null)
  const capabilityCallsValue: unknown = readValue(row, 'capabilityCalls', 'capability_calls_json', undefined)
  const supportedActionsValue: unknown = readValue(row, 'supportedActions', 'supported_actions', undefined)
  return {
    id: String(row.id ?? ''), skillVersionId: String(readValue(row, 'skillVersionId', 'skill_version_id', '')), status: String(row.status ?? 'created') as SkillRun['status'],
    revision: asNumber(row.revision), input: asObject(row.input), output: row.output && typeof row.output === 'object' ? row.output as Record<string, unknown> : null,
    context: asObject(row.context), surface: typeof row.surface === 'string' ? row.surface : null, sessionId: readValue(row, 'sessionId', 'session_id', null),
    imageSessionId: readValue(row, 'imageSessionId', 'image_session_id', null), waitingReason: readValue(row, 'waitingReason', 'waiting_reason', null),
    waitingSince: readValue(row, 'waitingSince', 'waiting_since', null), waitingExpiresAt: readValue(row, 'waitingExpiresAt', 'waiting_expires_at', null),
    requiredAction: requiredActionValue && (typeof requiredActionValue === 'object' || typeof requiredActionValue === 'string') ? asObject(requiredActionValue) : null,
    supportedActions: asArray(supportedActionsValue).filter((item: unknown): item is string => typeof item === 'string') as SkillRun['supportedActions'],
    version: versionValue && (typeof versionValue === 'object' || typeof versionValue === 'string') ? asObject(versionValue) as SkillRun['version'] : null,
    source: typeof row.source === 'string' ? row.source : null,
    budget: readValue(row, 'budget', 'budget_json', null) && (typeof readValue(row, 'budget', 'budget_json', null) === 'object' || typeof readValue(row, 'budget', 'budget_json', null) === 'string') ? asObject(readValue(row, 'budget', 'budget_json', null)) as SkillRun['budget'] : null,
    capabilityCalls: asArray(capabilityCallsValue).filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object')).map((item: Record<string, unknown>) => item as RunCapabilityCall),
    inputSummary: readValue(row, 'inputSummary', 'input_summary_json', null) && (typeof readValue(row, 'inputSummary', 'input_summary_json', null) === 'object' || typeof readValue(row, 'inputSummary', 'input_summary_json', null) === 'string') ? asObject(readValue(row, 'inputSummary', 'input_summary_json', null)) : null,
    outputSummary: readValue(row, 'outputSummary', 'output_summary_json', null) && (typeof readValue(row, 'outputSummary', 'output_summary_json', null) === 'object' || typeof readValue(row, 'outputSummary', 'output_summary_json', null) === 'string') ? asObject(readValue(row, 'outputSummary', 'output_summary_json', null)) : null,
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
    content: normalizeSkillDraftContent(row.content), baseVersionId: readValue(row, 'baseVersionId', 'base_version_id', null), revision: asNumber(row.revision),
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
    return toSkillRuntimeCapabilities(data)
  },
  async getSkillRuntimeDiagnostics(): Promise<SkillRuntimeDiagnosticsSnapshot> {
    const { data } = await apiFetch('/skill-runtime/diagnostics')
    return toSkillRuntimeDiagnostics(data)
  },
  async getSkillRuntimeSettings(): Promise<SkillRuntimeSettings> {
    const { data } = await apiFetch('/skill-runtime/settings')
    return toRuntimeSettings(data)
  },
  async updateSkillRuntimeSettings(patch: Record<string, unknown>): Promise<SkillRuntimeSettings> {
    const { data } = await apiFetch('/skill-runtime/settings', { method: 'PATCH', body: JSON.stringify(patch) })
    return toRuntimeSettings(data)
  },
  async rollbackSkillRuntimeSettings(): Promise<SkillRuntimeSettings> {
    const { data } = await apiFetch('/skill-runtime/settings/rollback', { method: 'POST', body: '{}' })
    return toRuntimeSettings(data)
  },
  async getSkillRuntimeFeatureFlags(): Promise<SkillRuntimeFeatureFlags> {
    const { data } = await apiFetch('/skill-runtime/feature-flags')
    return toFeatureFlags(data)
  },
  async updateSkillRuntimeFeatureFlags(patch: Record<string, boolean>): Promise<SkillRuntimeFeatureFlags> {
    const { data } = await apiFetch('/skill-runtime/feature-flags', { method: 'PATCH', body: JSON.stringify(patch) })
    return toFeatureFlags(data)
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
  async getSkillPackages(input: PackageListInput = {}): Promise<Page<SkillPackage>> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 20), offset: String(input.offset ?? 0) })
    if (input.search?.trim()) query.set('search', input.search.trim())
    if (input.sourceType?.trim()) query.set('sourceType', input.sourceType.trim())
    if (input.includeArchived !== undefined) query.set('includeArchived', String(input.includeArchived))
    if (input.sort) query.set('sort', input.sort)
    if (input.direction) query.set('direction', input.direction)
    return page(await apiFetch(`/skill-packages?${query.toString()}`), toSkillPackage)
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
  async inspectSkillPackage(source: PackageSource): Promise<PackageInspectionResult> {
    const { data } = await apiFetch('/skill-packages/inspect', { method: 'POST', body: JSON.stringify({ source }) })
    return toPackageInspectionResult(data)
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
    const onMessage = (message: MessageEvent) => {
      try {
        const payload = JSON.parse(message.data) as unknown
        if (asRecord(payload).runId || asRecord(payload).run_id) handlers.onEvent?.(toSkillRunEvent(payload))
      } catch (error) {
        handlers.onError?.(normalizeRuntimeError(null, 0, error instanceof Error ? error.message : 'Invalid event payload'))
      }
    }
    source.onmessage = onMessage
    const eventTypes = [...SKILL_RUN_EVENT_TYPES]
    for (const type of eventTypes) source.addEventListener(type, onMessage as EventListener)
    source.onerror = () => handlers.onError?.(normalizeRuntimeError(null, 0, 'Skill Run event stream disconnected'))
    return {
      close: () => {
        for (const type of eventTypes) source.removeEventListener(type, onMessage as EventListener)
        source.close()
      },
    }
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
  async getImportReview(reviewId: string): Promise<PackageImportReview> {
    const { data } = await apiFetch(`/skill-import-reviews/${encodeURIComponent(reviewId)}`)
    return toPackageImportReview(data)
  },
  async approveImportReview(reviewId: string): Promise<PackageImportReview> {
    const { data } = await apiFetch(`/skill-import-reviews/${encodeURIComponent(reviewId)}/approve`, { method: 'POST', body: JSON.stringify({}) })
    return toPackageImportReview(data)
  },
  async rejectImportReview(reviewId: string, reason?: string): Promise<PackageImportReview> {
    const { data } = await apiFetch(`/skill-import-reviews/${encodeURIComponent(reviewId)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) })
    return toPackageImportReview(data)
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
  async listSkillDrafts(input: DraftListInput = {}): Promise<Page<DraftDto>> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 20), offset: String(input.offset ?? 0) })
    if (input.status) query.set('status', input.status)
    return page(await apiFetch(`/skill-drafts?${query.toString()}`), toDraft)
  },
  async validateSkillDraft(draftId: string): Promise<DraftValidation> {
    const { data } = await apiFetch(`/skill-drafts/${encodeURIComponent(draftId)}/validate`, { method: 'POST', body: '{}' })
    return toDraftValidation(data)
  },
  async previewSkillDraft(draftId: string): Promise<DraftPreview> {
    const { data } = await apiFetch(`/skill-drafts/${encodeURIComponent(draftId)}/preview`, { method: 'POST', body: '{}' })
    return toDraftPreview(data)
  },
  async publishSkillDraft(draftId: string, input: { enable?: boolean; expectedRevision?: number; idempotencyKey?: string } = {}): Promise<CreatorPublishResult> {
    const { data } = await apiFetch(`/skill-drafts/${encodeURIComponent(draftId)}/publish`, { method: 'POST', body: JSON.stringify(input) })
    return normalizeCreatorPublishResult(data)
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
  async selectZipFile(): Promise<{ canceled: boolean; path?: string }> {
    if (!isElectron() || !window.bloomai?.selectZipFile) return { canceled: true }
    return window.bloomai.selectZipFile()
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
