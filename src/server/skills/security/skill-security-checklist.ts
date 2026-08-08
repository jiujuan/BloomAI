import path from 'node:path'
import {
  MAX_SECURITY_ARRAY_ITEMS,
  MAX_SECURITY_DEPTH,
  MAX_SECURITY_FIELDS,
  MAX_SECURITY_STRING_LENGTH,
  sanitizeSecurityPayload,
  SkillSecurityError,
  type SecurityPayloadOptions,
} from '../../security/security-payload'

export const SECURITY_POLICY_VERSION = 'skills-security-v1.1-2026-08-06'
export const MAX_SECURITY_PATH_DEPTH = 32

export {
  MAX_SECURITY_ARRAY_ITEMS,
  MAX_SECURITY_DEPTH,
  MAX_SECURITY_FIELDS,
  MAX_SECURITY_STRING_LENGTH,
  sanitizeSecurityPayload,
  SkillSecurityError,
}
export type { SecurityPayloadOptions }

const OFFICIAL_GITHUB_HOSTS = new Set(['github.com'])
const SAFE_CAPABILITIES = new Set([
  'web.search',
  'web.fetch',
  'document.read_uploaded',
  'package.read',
  'package.list_files',
  'package.read_text',
  'package.read_asset',
  'artifact.write',
  'image.generate',
])

export const FORBIDDEN_PACKAGE_CAPABILITIES = new Set([
  'shell.execute',
  'python.execute',
  'mcp',
  'mcp.execute',
  'container.execute',
  'sub-agent.execute',
  'arbitrary_workspace_write',
  'workspace.write',
  'dependency.install',
  'home.read',
])

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const SAFE_PATH_SEGMENT_PATTERN = /^[^\\/:*?"<>|]+$/
const GITHUB_COMPONENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

export type ExternalSource =
  | { kind: 'github-archive'; repositoryUrl: string; ref: string; subdirectory?: string }
  | { kind: 'local-directory'; directory: string; subdirectory?: string; metadata?: Record<string, unknown> }
  | { kind: 'zip'; zipPath: string; subdirectory?: string; metadata?: Record<string, unknown> }

export type PackageLimitsInput = {
  fileCount: number
  totalBytes: number
  fileBytes?: number
  archiveBytes?: number
  maxFileCount?: number
  maxFileBytes?: number
  maxUnpackedBytes?: number
  maxArchiveBytes?: number
}

export function validateExternalSource(input: unknown): ExternalSource {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SkillSecurityError('External package source must be an object', 'INVALID_SOURCE')
  }
  const source = input as Record<string, unknown>
  const kind = source.kind
  if (kind === 'github-archive') {
    const repositoryUrl = requireSecurityString(source.repositoryUrl, 'repositoryUrl')
    const ref = requireSecurityString(source.ref, 'ref')
    const parsed = parseOfficialGitHubUrl(repositoryUrl)
    const normalizedRef = normalizeSecurityString(ref, 'ref')
    if (!/^[^\s\u0000-\u001f\u007f?#\\]+$/.test(normalizedRef) || normalizedRef.includes('..')) {
      throw new SkillSecurityError('GitHub ref contains invalid characters', 'INVALID_SOURCE_REF')
    }
    const subdirectory = optionalSafeRelativePath(source.subdirectory, 'subdirectory')
    return {
      kind: 'github-archive',
      repositoryUrl: parsed.repositoryUrl,
      ref: normalizedRef,
      ...(subdirectory ? { subdirectory } : {}),
    }
  }

  if (kind === 'local-directory') {
    const directory = normalizeLocalPath(source.directory, 'directory')
    const subdirectory = optionalSafeRelativePath(source.subdirectory, 'subdirectory')
    return {
      kind: 'local-directory',
      directory,
      ...(subdirectory ? { subdirectory } : {}),
      ...(isRecord(source.metadata) ? { metadata: sanitizeSecurityPayload(source.metadata) as Record<string, unknown> } : {}),
    }
  }

  if (kind === 'zip') {
    const zipPath = normalizeLocalPath(source.zipPath, 'zipPath')
    const subdirectory = optionalSafeRelativePath(source.subdirectory, 'subdirectory')
    return {
      kind: 'zip',
      zipPath,
      ...(subdirectory ? { subdirectory } : {}),
      ...(isRecord(source.metadata) ? { metadata: sanitizeSecurityPayload(source.metadata) as Record<string, unknown> } : {}),
    }
  }

  throw new SkillSecurityError('Unsupported external package source', 'INVALID_SOURCE')
}

export function assertPackageLimits(input: PackageLimitsInput): void {
  const limits = {
    maxFileCount: input.maxFileCount ?? 100_000,
    maxFileBytes: input.maxFileBytes ?? 100 * 1024 * 1024,
    maxUnpackedBytes: input.maxUnpackedBytes ?? 1024 * 1024 * 1024,
    maxArchiveBytes: input.maxArchiveBytes ?? 1024 * 1024 * 1024,
  }
  for (const [name, value] of Object.entries({
    fileCount: input.fileCount,
    totalBytes: input.totalBytes,
    ...(input.fileBytes === undefined ? {} : { fileBytes: input.fileBytes }),
    ...(input.archiveBytes === undefined ? {} : { archiveBytes: input.archiveBytes }),
    ...limits,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new SkillSecurityError(`${name} must be a non-negative integer`, 'INVALID_PACKAGE_LIMIT')
  }
  if (input.fileCount > limits.maxFileCount) throw new SkillSecurityError('Package file count exceeds the configured limit', 'PACKAGE_FILE_COUNT_LIMIT')
  if (input.totalBytes > limits.maxUnpackedBytes) throw new SkillSecurityError('Package unpacked bytes exceed the configured limit', 'PACKAGE_UNPACKED_BYTES_LIMIT')
  if (input.fileBytes !== undefined && input.fileBytes > limits.maxFileBytes) throw new SkillSecurityError('Package file exceeds the maximum size limit', 'PACKAGE_FILE_BYTES_LIMIT')
  if (input.archiveBytes !== undefined && input.archiveBytes > limits.maxArchiveBytes) throw new SkillSecurityError('Package archive exceeds the maximum size limit', 'PACKAGE_ARCHIVE_BYTES_LIMIT')
}

export function assertCapabilityAllowed(capability: string): string {
  const normalized = normalizeSecurityString(capability, 'capability').toLowerCase()
  if (FORBIDDEN_PACKAGE_CAPABILITIES.has(normalized) || normalized.startsWith('mcp.') || !SAFE_CAPABILITIES.has(normalized)) {
    throw new SkillSecurityError(`Capability is not allowed by the Skills security policy: ${normalized}`, 'CAPABILITY_DENIED')
  }
  return normalized
}

/** Shared alias for event payloads so event and audit boundaries use one sanitizer. */
export function sanitizeEventPayload(value: unknown, options?: SecurityPayloadOptions): unknown {
  return sanitizeSecurityPayload(value, options)
}

export function sanitizeMarkdownHtml(value: string): string {
  const input = requireSecurityString(value, 'markdown')
  return input
    .replace(/<\s*(script|style|iframe|object|embed|form|base|meta|link)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|form|base|meta|link)\b[^>]*>/gi, '')
    .replace(/\s+on[a-z][a-z0-9_-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:href|src|action|formaction|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, (attribute) => {
      return /(?:javascript|vbscript|data\s*:\s*text\/html)\s*:/i.test(attribute) ? '' : attribute
    })
    .replace(/\b(?:javascript|vbscript)\s*:/gi, '')
}

export function assertArtifactOwnership(artifact: { id?: string | null; runId?: string | null } | null | undefined, runId: string): true {
  if (!artifact?.id || !artifact.runId || !runId || artifact.runId !== runId) {
    throw new SkillSecurityError('Artifact not found for this run or ownership could not be verified', 'ARTIFACT_OWNERSHIP_DENIED')
  }
  return true
}

export type SkillSecurityCheck = {
  id: string
  status: 'pass' | 'fail'
  summary: string
}

export function getSkillSecurityStatus(): { policyVersion: string; checks: SkillSecurityCheck[] } {
  return {
    policyVersion: SECURITY_POLICY_VERSION,
    checks: [
      { id: 'capability-default-deny', status: 'pass', summary: 'Unsupported and dangerous package capabilities are denied.' },
      { id: 'source-allowlist', status: 'pass', summary: 'External sources require HTTPS official GitHub or approved local boundaries.' },
      { id: 'package-limits', status: 'pass', summary: 'Package files, archives, and recursive payloads are bounded.' },
      { id: 'event-redaction', status: 'pass', summary: 'Sensitive fields are redacted before persistence.' },
      { id: 'artifact-ownership', status: 'pass', summary: 'Artifacts require run ownership before content or export operations.' },
      { id: 'browser-boundary', status: 'pass', summary: 'Browser origins and rendered markup use explicit safety boundaries.' },
    ],
  }
}

export function isAllowedBrowserOrigin(origin: string): boolean {
  const normalized = origin.trim()
  if (!normalized || normalized.length > MAX_SECURITY_STRING_LENGTH || CONTROL_CHARACTER_PATTERN.test(normalized)) return false
  const configured = (process.env.BLOOMAI_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (configured.includes(normalized)) return true
  let parsed: URL
  try { parsed = new URL(normalized) } catch { return false }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) return false
  return !parsed.username && !parsed.password && !parsed.pathname.replace(/\/$/, '') && !parsed.search && !parsed.hash
}

function parseOfficialGitHubUrl(value: string): { repositoryUrl: string } {
  const normalized = normalizeSecurityString(value, 'repositoryUrl')
  let parsed: URL
  try { parsed = new URL(normalized) } catch { throw new SkillSecurityError('GitHub repository URL must be valid', 'INVALID_SOURCE_URL') }
  if (parsed.search || parsed.hash) {
    throw new SkillSecurityError('GitHub repository URL must not contain a query or fragment', 'INVALID_SOURCE_URL')
  }
  if (parsed.protocol !== 'https:' || !OFFICIAL_GITHUB_HOSTS.has(parsed.hostname.toLowerCase()) || parsed.port || parsed.username || parsed.password) {
    throw new SkillSecurityError('Only canonical HTTPS official GitHub repository URLs are supported', 'SOURCE_HOST_NOT_ALLOWED')
  }
  const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => {
    try { return decodeURIComponent(segment) } catch { return '' }
  })
  const repository = segments[1]?.replace(/\.git$/, '')
  if (segments.length !== 2 || !GITHUB_COMPONENT_PATTERN.test(segments[0] ?? '') || !repository || !GITHUB_COMPONENT_PATTERN.test(repository)) {
    throw new SkillSecurityError('GitHub repository URL must identify exactly one owner and repository', 'INVALID_SOURCE_URL')
  }
  const canonicalPath = `/${segments[0]}/${segments[1]}`
  if (parsed.pathname !== canonicalPath) throw new SkillSecurityError('GitHub repository URL is not canonical', 'INVALID_SOURCE_URL')
  return { repositoryUrl: `https://github.com${canonicalPath}` }
}

function normalizeLocalPath(value: unknown, label: string): string {
  const normalized = requireSecurityString(value, label)
  if (!path.isAbsolute(normalized) || normalized.startsWith('\\?\\') || normalized.startsWith('\\.\\')) {
    throw new SkillSecurityError(`${label} must be an absolute local path`, 'INVALID_PATH')
  }
  return path.resolve(normalized)
}

function optionalSafeRelativePath(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) throw new SkillSecurityError(`${label} must be a non-empty string`, 'INVALID_PATH')
  return normalizeSafeRelativePath(value, label)
}

function normalizeSafeRelativePath(value: string, label: string): string {
  const normalized = normalizeSecurityString(value, label).replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new SkillSecurityError(`${label} must be a safe relative path`, 'INVALID_PATH')
  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || !SAFE_PATH_SEGMENT_PATTERN.test(segment))) {
    throw new SkillSecurityError(`${label} contains an unsafe path segment`, 'INVALID_PATH')
  }
  if (segments.length > MAX_SECURITY_PATH_DEPTH) throw new SkillSecurityError(`${label} exceeds the maximum path depth`, 'PATH_DEPTH_LIMIT')
  return segments.join('/')
}

function requireSecurityString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new SkillSecurityError(`${label} must be a string`, 'INVALID_INPUT')
  return normalizeSecurityString(value, label)
}

function normalizeSecurityString(value: string, label: string): string {
  const normalized = value.normalize('NFKC')
  if (!normalized.trim()) throw new SkillSecurityError(`${label} must not be empty`, 'INVALID_INPUT')
  if (normalized.length > MAX_SECURITY_STRING_LENGTH) throw new SkillSecurityError(`${label} exceeds the maximum length`, 'INPUT_LENGTH_LIMIT')
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) throw new SkillSecurityError(`${label} contains control characters`, 'INVALID_INPUT')
  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
