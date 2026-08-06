import { API_BASE } from '@shared/constants'

export type PaginationInput = { limit?: number; offset?: number }
export type SkillRuntimeSourceFilter = 'all' | 'legacy' | 'package'
export type SkillRuntimeFilterStatus = 'all' | 'enabled' | 'disabled' | 'attention'

export type PaginationMeta = { limit: number; offset: number; total: number; hasMore: boolean; nextOffset: number | null }
export type Page<T> = { data: T[]; meta: PaginationMeta }

export type RuntimeErrorCode =
  | 'FEATURE_DISABLED'
  | 'VALIDATION_ERROR'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'ARTIFACT_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'NETWORK_ERROR'
  | string

export type RuntimeError = {
  code: RuntimeErrorCode
  message: string
  status: number
  requestId?: string
  retryable?: boolean
  details?: Record<string, unknown>
}

export type CapabilityScope = {
  allowedRoots?: string[]
  allowedDomains?: string[]
  allowedModels?: string[]
  maxCalls?: number
  [key: string]: unknown
}

export type CapabilityDto = {
  id: string
  skillVersionId: string
  capability: string
  scope: CapabilityScope
  status?: 'requested' | 'approved' | 'rejected' | 'revoked' | 'expired' | string
  grantMode?: string
  /** @deprecated Compatibility projection for the pre-v1.1 Skills page. */
  grant_mode?: string
  grantedBy?: string | null
  grantedAt?: number | null
  expiresAt?: number | null
  revokedAt?: number | null
  consumedAt?: number | null
  requestedScope?: CapabilityScope
  grantedScope?: CapabilityScope
  usage?: { calls: number; bytes?: number; lastUsedAt?: number | null }
}

/** @deprecated Use CapabilityDto. Kept as a stable alias for existing Skills UI imports. */
export type CapabilityGrant = CapabilityDto & {
  skill_version_id?: string
  scope_json?: string
  grant_mode?: string
  granted_by?: string | null
  granted_at?: number
  expires_at?: number | null
  revoked_at?: number | null
  consumed_at?: number | null
  session_id?: string | null
}

export type RequestedCapability = { capability: string; scope: CapabilityScope }

export type PackageManifest = {
  name: string
  description: string
  runtime: string
  entryPath: string
  compatible: boolean
  requestedCapabilities: RequestedCapability[]
  recommendedSurface?: string
  outputArtifactTypes: string[]
  references: string[]
  assets: string[]
  scripts: string[]
  unsupported: string[]
  unknownFrontmatter: Record<string, unknown>
  files?: Array<{ path: string; sha256: string; sizeBytes: number }>
}

export type SkillPackage = {
  id: string
  name: string
  description: string
  sourceType: string
  sourceUri: string | null
  sourceRef: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  deleteReason: string | null
  /** @deprecated Compatibility projection for the pre-v1.1 Skills page. */
  delete_reason?: string | null
  /** @deprecated Compatibility projection for the pre-v1.1 Skills page. */
  source_type?: string
  /** @deprecated Compatibility projection for the pre-v1.1 Skills page. */
  source_uri?: string | null
  /** @deprecated Compatibility projection for the pre-v1.1 Skills page. */
  source_ref?: string | null
  /** @deprecated Compatibility projection for the pre-v1.1 Skills page. */
  created_at?: number
  /** @deprecated Compatibility projection for the pre-v1.1 Skills page. */
  updated_at?: number
  /** @deprecated Compatibility projection for the pre-v1.1 Skills page. */
  deleted_at?: number | null
}

export type SkillVersion = {
  id: string
  packageId: string
  version: string
  runtime: string
  manifest: Record<string, unknown>
  manifestHash: string
  packagePath: string
  sourceSnapshot: Record<string, unknown>
  /** @deprecated Compatibility projection for the pre-v1.1 Skills page. */
  source_snapshot_json?: string
  isCompatible: boolean
  immutableHash?: string
  status?: string
  securityStatus?: string
  snapshotHash?: string
  publishedAt?: number | null
  createdAt: number
  /** @deprecated Compatibility projection for the pre-v1.1 Skills page. */
  package_id?: string
  manifest_json?: string
  package_path?: string
  manifest_hash?: string
  is_compatible?: number
  immutable_hash?: string
  security_status?: string
  snapshot_hash?: string
  published_at?: number | null
  created_at?: number
}

export type SkillInstallation = {
  id: string
  packageId: string
  currentVersionId: string
  status: string
  enabled: boolean | 0 | 1
  installedAt: number
  updatedAt: number
  previousVersionId?: string | null
  revision: number
  changedAt?: number | null
  disabledAt?: number | null
  uninstalledAt?: number | null
  deletedAt?: number | null
  rollbackReason?: string | null
  /** @deprecated Compatibility projection for the pre-v1.1 Skills page. */
  package_id?: string
  current_version_id?: string
  enabled_legacy?: number
  installed_at?: number
  updated_at?: number
  previous_version_id?: string | null
  changed_at?: number | null
  disabled_at?: number | null
  uninstalled_at?: number | null
  deleted_at?: number | null
  rollback_reason?: string | null
}

export type PackageDetail = {
  package: SkillPackage
  versions: SkillVersion[]
  installations: SkillInstallation[]
  capabilityGrants: CapabilityGrant[]
}

export type PackageSource =
  | { kind: 'local-directory'; directory: string; subdirectory?: string; metadata?: { origin?: 'local' | 'npx-artifact' } }
  | { kind: 'zip'; zipPath: string; subdirectory?: string; metadata?: { origin?: 'local' | 'npx-artifact' } }
  | { kind: 'github-archive'; repositoryUrl: string; ref: string; subdirectory?: string }

export type PackageInstallInput = {
  source: PackageSource
  reviewId: string
  sourceFingerprint: string
  confirm: true
}

export type InspectedPackage = {
  sourceType: string
  relativeSkillPath: string
  manifestHash: string
  manifest: PackageManifest
  sourceSnapshot: {
    sourceSha256: string
    sourceCommit?: string
    sourceRef?: string
    files: Array<{ path: string; sha256: string; sizeBytes: number }>
  }
}

export type VersionCandidate = {
  version: string
  manifest: Record<string, unknown>
  manifestHash: string
  packagePath: string
  sourceSnapshot?: Record<string, unknown>
  isCompatible?: boolean
  status?: string
  securityStatus?: string
  snapshotHash?: string
}

export type SkillRunStatus = 'created' | 'validating' | 'running' | 'waiting_input' | 'waiting_approval' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled' | 'interrupted'

export type RunActionType = 'confirm' | 'approve' | 'reject' | 'resume' | 'retry' | 'submit_input' | 'modify' | 'cancel'

export type RunBudget = {
  used?: number
  limit?: number
  unit?: string
  remaining?: number
  [key: string]: unknown
}

export type RunCapabilityCall = {
  id: string
  capability: string
  status: string
  scope?: CapabilityScope
  startedAt?: number | null
  finishedAt?: number | null
  error?: string | null
  [key: string]: unknown
}

export type RunVersionSummary = {
  id: string
  version: string
  source?: string | null
  sourceHash?: string | null
}

export type RunInputField = {
  name: string
  label: string
  type?: 'text' | 'textarea' | 'number' | 'url' | 'select' | 'boolean' | string
  required?: boolean
  secret?: boolean
  placeholder?: string
  options?: Array<{ label: string; value: string }>
}

export type RunRequiredAction = {
  type?: string
  grantId?: string
  capability?: string
  requestedScope?: CapabilityScope
  grantedScope?: CapabilityScope
  risk?: string
  fields?: RunInputField[]
  reason?: string
  [key: string]: unknown
}

export type RunAction =
  | { type: 'confirm'; idempotencyKey: string; expectedRevision: number }
  | { type: 'approve'; idempotencyKey: string; expectedRevision: number }
  | { type: 'reject'; idempotencyKey: string; expectedRevision: number; reason?: string }
  | { type: 'resume'; idempotencyKey: string; expectedRevision: number }
  | { type: 'retry'; idempotencyKey: string; expectedRevision: number }
  | { type: 'submit_input'; idempotencyKey: string; expectedRevision: number; input: Record<string, unknown> }
  | { type: 'modify'; idempotencyKey: string; expectedRevision: number; patchInput: Record<string, unknown> }
  | { type: 'cancel'; idempotencyKey: string; expectedRevision: number }

export type SkillRun = {
  id: string
  skillVersionId: string
  status: SkillRunStatus
  revision: number
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  context: Record<string, unknown>
  surface: string | null
  sessionId: string | null
  imageSessionId: string | null
  waitingReason: string | null
  waitingSince?: number | null
  waitingExpiresAt?: number | null
  requiredAction?: RunRequiredAction | null
  supportedActions?: RunActionType[]
  version?: RunVersionSummary | null
  source?: string | null
  budget?: RunBudget | null
  capabilityCalls?: RunCapabilityCall[]
  inputSummary?: Record<string, unknown> | null
  outputSummary?: Record<string, unknown> | null
  cancelRequested: boolean
  startedAt: number | null
  updatedAt: number
  finishedAt: number | null
  errorCode: string | null
  errorMessage: string | null
  resultSummary?: string | null
}

export type SkillRunEvent = {
  id: string
  runId: string
  seq: number
  schemaVersion: number
  producer: string
  type: string
  payload: Record<string, unknown>
  occurredAt: number
  createdAt: number
}

export type SkillArtifact = {
  id: string
  runId: string
  kind: string
  mimeType: string | null
  path: string
  sizeBytes: number
  sha256: string
  metadata: Record<string, unknown>
  createdAt: number
  retentionUntil?: number | null
  exportedAt?: number | null
  /** @deprecated Compatibility projection for the pre-v1.1 Skills page. */
  run_id?: string
  mime_type?: string | null
  size_bytes?: number
  metadata_json?: string
  created_at?: number
}

export type SkillDraftContent = {
  name: string
  slug: string
  version?: string
  description?: string
  skillMd: string
  references?: Record<string, string>
  assets?: Array<{ path: string; sizeBytes?: number; mimeType?: string }>
  capabilities?: RequestedCapability[]
  visibility?: 'private' | 'workspace' | 'public'
  author?: string
}

export type DraftDto = {
  id: string
  ownerId?: string
  content: SkillDraftContent
  baseVersionId?: string | null
  revision: number
  status?: 'draft' | 'published' | 'discarded' | string
  createdAt?: number
  updatedAt?: number
}

export type DraftValidationIssue = {
  path?: string
  file?: string
  line?: number
  column?: number
  message: string
  code?: string
}

export type DraftValidation = {
  valid: boolean
  errors: DraftValidationIssue[]
  warnings: DraftValidationIssue[]
}

export type DraftPreview = {
  draft: DraftDto
  validation: DraftValidation
  immutableVersion?: { id: string; version: string; sourceHash: string }
  capabilityRisks?: Array<{ capability: string; scope: CapabilityScope; severity: string }>
}

export type SkillRuntimeCapabilities = {
  protocolVersion: string
  configVersion: string
  runtimeEnabled: boolean
  packageExecutionEnabled: boolean
  importEnabled: boolean
  githubImportEnabled: boolean
  npxImportEnabled: boolean
  creatorEnabled: boolean
  creatorPublishEnabled: boolean
  limits: Record<string, number>
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

export function formatDate(value: number | null | undefined) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value) : '—'
}

export function artifactContentUrl(artifactId: string, runId: string) {
  return API_BASE + '/skill-artifacts/' + encodeURIComponent(artifactId) + '/content?runId=' + encodeURIComponent(runId)
}