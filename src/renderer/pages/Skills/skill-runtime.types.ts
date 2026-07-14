import { API_BASE } from '@shared/constants'

export type CapabilityScope = {
  allowedRoots?: string[]
  allowedDomains?: string[]
  allowedModels?: string[]
  maxCalls?: number
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
  source_type: string
  source_uri: string | null
  source_ref: string | null
  created_at: number
  updated_at: number
}

export type SkillVersion = {
  id: string
  package_id: string
  version: string
  runtime: string
  manifest_json: string
  manifest_hash: string
  package_path: string
  source_snapshot_json: string
  is_compatible: number
  created_at: number
}

export type SkillInstallation = {
  id: string
  package_id: string
  current_version_id: string
  status: string
  enabled: number
  installed_at: number
  updated_at: number
}

export type CapabilityGrant = {
  id: string
  skill_version_id: string
  capability: string
  grant_mode: string
  scope_json: string
  granted_by: string | null
  granted_at: number
  expires_at: number | null
  revoked_at: number | null
  session_id: string | null
  consumed_at: number | null
}

export type PackageDetail = {
  package: SkillPackage
  versions: SkillVersion[]
  installations: SkillInstallation[]
  capabilityGrants: CapabilityGrant[]
}

export type PackageSource = {
  kind: 'github-archive'
  repositoryUrl: string
  ref: string
  subdirectory?: string
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

export type SkillRunStatus = 'created' | 'validating' | 'running' | 'waiting_input' | 'waiting_approval' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled' | 'interrupted'

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
  cancelRequested: boolean
  startedAt: number | null
  updatedAt: number
  finishedAt: number | null
  errorCode: string | null
  errorMessage: string | null
}

export type SkillRunEvent = {
  id: string
  runId: string
  seq: number
  schemaVersion: number
  type: string
  payload: Record<string, unknown>
  createdAt: number
}

export type SkillArtifact = {
  id: string
  run_id: string
  kind: string
  mime_type: string | null
  path: string
  size_bytes: number
  sha256: string
  metadata_json: string
  created_at: number
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

export function formatDate(value: number | null | undefined) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value) : '—'
}

export function artifactContentUrl(artifactId: string) {
  return API_BASE + '/skill-artifacts/' + encodeURIComponent(artifactId) + '/content'
}
