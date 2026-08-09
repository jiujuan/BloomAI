import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDataDir, getDbPath } from '../../db/paths'
import { skillCapabilitySchema } from '../policy/capability-policy'
import { settingsRepo } from '../../db/repositories/settings.repo'

export const SKILL_RUNTIME_PROTOCOL_VERSION = '1.1'
export const SKILL_RUNTIME_CONFIG_VERSION = '2026-08-05'

export const LEGACY_SKILL_LIFECYCLES = [
  'active',
  'frozen',
  'read-only',
  'migrated',
  'manual_review',
  'blocked',
  'archived',
  'runner_removed',
] as const

export type LegacySkillLifecycle = (typeof LEGACY_SKILL_LIFECYCLES)[number]

export type SkillRuntimeOperationalStatus = 'ready' | 'degraded' | 'disabled'

export type SkillRuntimeOperationalSnapshot = {
  status: SkillRuntimeOperationalStatus
  reason: 'runtime_ready' | 'package_execution_disabled' | 'runtime_disabled'
  canManage: boolean
  canExecute: boolean
}

export const SKILL_RUNTIME_SOURCE_KINDS = ['local-directory', 'zip', 'github-archive'] as const

export type SkillRuntimeSourceKind = (typeof SKILL_RUNTIME_SOURCE_KINDS)[number]

export type SkillRuntimeConfig = {
  protocolVersion: string
  configVersion: string
  runtimeEnabled: boolean
  packageExecutionEnabled: boolean
  legacyLifecycle: LegacySkillLifecycle
  legacyReadOnly: boolean
  legacyExecutionEnabled: boolean
  importEnabled: boolean
  githubImportEnabled: boolean
  npxImportEnabled: boolean
  creatorEnabled: boolean
  creatorPublishEnabled: boolean
  workerConcurrency: number
  leaseTimeoutMs: number
  maxAttempts: number
  eventRetentionDays: number
  artifactRetentionDays: number
  packageDataRoot: string
  artifactRoot: string
  exportRoot: string
  maxPackageBytes: number
  maxPackageFiles: number
  maxFileBytes: number
  maxRunDurationMs: number
  githubRequestTimeoutMs: number
  githubMaxArchiveBytes: number
  githubAllowedHosts: string[]
}

export type SkillRuntimeConfigEnv = Record<string, string | undefined>

/**
 * Runtime settings that may be overridden through the v1.2 administrative
 * API. Legacy lifecycle flags and filesystem roots deliberately do not appear
 * here: those values remain deployment boundaries, not user-managed settings.
 */
export const SKILL_RUNTIME_SETTING_FIELDS = [
  'runtimeEnabled',
  'packageExecutionEnabled',
  'importEnabled',
  'githubImportEnabled',
  'npxImportEnabled',
  'creatorEnabled',
  'creatorPublishEnabled',
  'workerConcurrency',
  'leaseTimeoutMs',
  'maxAttempts',
  'eventRetentionDays',
  'artifactRetentionDays',
  'maxPackageBytes',
  'maxPackageFiles',
  'maxFileBytes',
  'maxRunDurationMs',
  'githubRequestTimeoutMs',
  'githubMaxArchiveBytes',
  'githubAllowedHosts',
] as const

export type SkillRuntimeSettingField = (typeof SKILL_RUNTIME_SETTING_FIELDS)[number]

export type SkillRuntimeFsAdapter = {
  existsSync: (target: string) => boolean
  mkdirSync?: (target: string, options?: { recursive?: boolean }) => void
}

export type SkillRuntimeCapabilities = {
  operationalStatus: SkillRuntimeOperationalStatus
  statusReason: SkillRuntimeOperationalSnapshot['reason']
  canManage: boolean
  canExecute: boolean
  sourcePolicy: {
    allowedKinds: SkillRuntimeSourceKind[]
  }
  capabilityPolicy: {
    allowedCapabilities: string[]
  }
  protocolVersion: string
  configVersion: string
  runtimeEnabled: boolean
  packageExecutionEnabled: boolean
  legacyLifecycle: LegacySkillLifecycle
  legacyReadOnly: boolean
  legacyExecutionEnabled: boolean
  importEnabled: boolean
  githubImportEnabled: boolean
  npxImportEnabled: boolean
  creatorEnabled: boolean
  creatorPublishEnabled: boolean
  limits: {
    workerConcurrency: number
    leaseTimeoutMs: number
    maxAttempts: number
    eventRetentionDays: number
    artifactRetentionDays: number
    maxPackageBytes: number
    maxPackageFiles: number
    maxFileBytes: number
    maxRunDurationMs: number
    githubRequestTimeoutMs: number
    githubMaxArchiveBytes: number
    githubAllowedHosts: string[]
  }
}

export class SkillRuntimeConfigError extends Error {
  readonly code = 'INVALID_SKILL_RUNTIME_CONFIG'

  constructor(message: string) {
    super(message)
    this.name = 'SkillRuntimeConfigError'
  }
}

export class SkillRuntimeFeatureDisabledError extends Error {
  readonly code = 'FEATURE_DISABLED'

  constructor(feature: string) {
    super(`Skill Runtime feature is disabled: ${feature}`)
    this.name = 'SkillRuntimeFeatureDisabledError'
  }
}

const BOOL_TRUE = new Set(['1', 'true', 'yes', 'on'])
const BOOL_FALSE = new Set(['0', 'false', 'no', 'off'])
const OFFICIAL_GITHUB_HOSTS = new Set(['github.com', 'api.github.com', 'codeload.github.com'])
const HARD_LIMITS = {
  workerConcurrency: 64,
  leaseTimeoutMs: 24 * 60 * 60 * 1000,
  maxAttempts: 20,
  eventRetentionDays: 3650,
  artifactRetentionDays: 3650,
  maxPackageBytes: 1024 * 1024 * 1024,
  maxPackageFiles: 100_000,
  maxFileBytes: 100 * 1024 * 1024,
  maxRunDurationMs: 24 * 60 * 60 * 1000,
  githubRequestTimeoutMs: 5 * 60 * 1000,
  githubMaxArchiveBytes: 1024 * 1024 * 1024,
} as const

function envBool(env: SkillRuntimeConfigEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') return fallback
  const normalized = raw.trim().toLowerCase()
  if (BOOL_TRUE.has(normalized)) return true
  if (BOOL_FALSE.has(normalized)) return false
  throw new SkillRuntimeConfigError(`${key} must be a boolean`)
}

function envEnum<T extends string>(env: SkillRuntimeConfigEnv, key: string, fallback: T, allowed: readonly T[]): T {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = raw.trim() as T
  if (!allowed.includes(value)) throw new SkillRuntimeConfigError(`${key} must be one of: ${allowed.join(', ')}`)
  return value
}

function envList(env: SkillRuntimeConfigEnv, key: string, fallback: string[]): string[] {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') return [...fallback]
  const values = raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
  if (values.length === 0 || values.some((value) => !OFFICIAL_GITHUB_HOSTS.has(value))) {
    throw new SkillRuntimeConfigError(`${key} must contain only official GitHub hosts`)
  }
  return [...new Set(values)]
}

function envInt(env: SkillRuntimeConfigEnv, key: string, fallback: number, max: number): number {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') return fallback
  if (!/^\d+$/.test(raw.trim())) throw new SkillRuntimeConfigError(`${key} must be a positive integer`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new SkillRuntimeConfigError(`${key} must be between 1 and ${max}`)
  }
  return value
}

function defaultRoot(name: string): string {
  return path.join(getDataDir(), 'skills', name)
}

function envPath(env: SkillRuntimeConfigEnv, key: string, fallback: string): string {
  const raw = env[key]?.trim()
  return raw || fallback
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function validateRoot(root: string, label: string, fsAdapter: SkillRuntimeFsAdapter): void {
  if (!path.isAbsolute(root)) throw new SkillRuntimeConfigError(`${label} must be an absolute path`)
  if (root === path.parse(root).root) throw new SkillRuntimeConfigError(`${label} cannot be a filesystem root`)
  if (isWithin(path.resolve(process.cwd()), root)) {
    throw new SkillRuntimeConfigError(`${label} cannot be inside the application source directory`)
  }
  const dbPath = path.resolve(getDbPath())
  if (root === dbPath || isWithin(root, dbPath)) {
    throw new SkillRuntimeConfigError(`${label} cannot overlap the database file`)
  }
  if (fsAdapter.existsSync(root)) {
    // The adapter is intentionally limited to existence checks. The runtime creates
    // missing directories only after validation and never treats an existing file as a root.
    try {
      if (fs.statSync(root).isFile()) throw new SkillRuntimeConfigError(`${label} must be a directory`)
    } catch (error) {
      if (error instanceof SkillRuntimeConfigError) throw error
      // A test adapter may not expose a real filesystem entry; defer the type check.
    }
  }
}

export function assertSkillRuntimeConfig(config: SkillRuntimeConfig, fsAdapter: SkillRuntimeFsAdapter = fs): SkillRuntimeConfig {
  for (const [key, max] of Object.entries(HARD_LIMITS) as Array<[keyof typeof HARD_LIMITS, number]>) {
    const value = config[key]
    if (!Number.isSafeInteger(value) || value < 1 || value > max) {
      throw new SkillRuntimeConfigError(`${key} must be between 1 and ${max}`)
    }
  }
  validateRoot(config.packageDataRoot, 'packageDataRoot', fsAdapter)
  validateRoot(config.artifactRoot, 'artifactRoot', fsAdapter)
  validateRoot(config.exportRoot, 'exportRoot', fsAdapter)
  const roots = [
    ['packageDataRoot', config.packageDataRoot],
    ['artifactRoot', config.artifactRoot],
    ['exportRoot', config.exportRoot],
  ] as const
  for (let left = 0; left < roots.length; left += 1) {
    for (let right = left + 1; right < roots.length; right += 1) {
      if (isWithin(roots[left][1], roots[right][1]) || isWithin(roots[right][1], roots[left][1])) {
        throw new SkillRuntimeConfigError(`${roots[left][0]} and ${roots[right][0]} cannot overlap`)
      }
    }
  }
  if (config.githubImportEnabled && !config.importEnabled) {
    throw new SkillRuntimeConfigError('githubImportEnabled requires importEnabled')
  }
  if (config.npxImportEnabled && !config.importEnabled) {
    throw new SkillRuntimeConfigError('npxImportEnabled requires importEnabled')
  }
  if (config.creatorPublishEnabled && !config.creatorEnabled) {
    throw new SkillRuntimeConfigError('creatorPublishEnabled requires creatorEnabled')
  }
  if (!Number.isSafeInteger(config.githubRequestTimeoutMs) || config.githubRequestTimeoutMs < 1 || config.githubRequestTimeoutMs > HARD_LIMITS.githubRequestTimeoutMs) {
    throw new SkillRuntimeConfigError('githubRequestTimeoutMs must be within the configured hard limit')
  }
  if (!Number.isSafeInteger(config.githubMaxArchiveBytes) || config.githubMaxArchiveBytes < 1 || config.githubMaxArchiveBytes > HARD_LIMITS.githubMaxArchiveBytes) {
    throw new SkillRuntimeConfigError('githubMaxArchiveBytes must be within the configured hard limit')
  }
  if (!Array.isArray(config.githubAllowedHosts) || config.githubAllowedHosts.length === 0 || config.githubAllowedHosts.some((host) => !OFFICIAL_GITHUB_HOSTS.has(host))) {
    throw new SkillRuntimeConfigError('githubAllowedHosts must contain only official GitHub hosts')
  }
  if (config.packageExecutionEnabled && !config.runtimeEnabled) {
    throw new SkillRuntimeConfigError('packageExecutionEnabled requires runtimeEnabled')
  }
  if (!LEGACY_SKILL_LIFECYCLES.includes(config.legacyLifecycle)) {
    throw new SkillRuntimeConfigError('legacyLifecycle is invalid')
  }
  if (config.legacyExecutionEnabled && (config.legacyReadOnly || config.legacyLifecycle !== 'active')) {
    throw new SkillRuntimeConfigError('legacyExecutionEnabled requires an active, writable Legacy lifecycle')
  }
  return config
}

function loadSkillRuntimeConfigFromEnv(
  env: SkillRuntimeConfigEnv,
  fsAdapter: SkillRuntimeFsAdapter,
): SkillRuntimeConfig {
  const legacyRuntimeFlag = env.SKILL_PACKAGE_RUNTIME_ENABLED
  const legacyEnabled = legacyRuntimeFlag === undefined
    ? undefined
    : envBool({ LEGACY: legacyRuntimeFlag }, 'LEGACY', false)

  const config: SkillRuntimeConfig = {
    protocolVersion: SKILL_RUNTIME_PROTOCOL_VERSION,
    configVersion: SKILL_RUNTIME_CONFIG_VERSION,
    runtimeEnabled: envBool(env, 'SKILL_RUNTIME_ENABLED', legacyEnabled ?? true),
    packageExecutionEnabled: envBool(env, 'SKILL_PACKAGE_EXECUTION_ENABLED', legacyEnabled ?? false),
    legacyLifecycle: envEnum(env, 'SKILL_LEGACY_LIFECYCLE', 'frozen', LEGACY_SKILL_LIFECYCLES),
    legacyReadOnly: envBool(env, 'SKILL_LEGACY_READ_ONLY', true),
    legacyExecutionEnabled: envBool(env, 'SKILL_LEGACY_EXECUTION_ENABLED', false),
    importEnabled: envBool(env, 'SKILL_PACKAGE_IMPORT_ENABLED', legacyEnabled ?? false),
    githubImportEnabled: envBool(env, 'SKILL_GITHUB_IMPORT_ENABLED', legacyEnabled ?? false),
    npxImportEnabled: envBool(env, 'SKILL_NPX_IMPORT_ENABLED', legacyEnabled ?? false),
    creatorEnabled: envBool(env, 'SKILL_CREATOR_ENABLED', false),
    creatorPublishEnabled: envBool(env, 'SKILL_CREATOR_PUBLISH_ENABLED', false),
    workerConcurrency: envInt(env, 'SKILL_WORKER_CONCURRENCY', 1, HARD_LIMITS.workerConcurrency),
    leaseTimeoutMs: envInt(env, 'SKILL_LEASE_TIMEOUT_MS', 60_000, HARD_LIMITS.leaseTimeoutMs),
    maxAttempts: envInt(env, 'SKILL_MAX_ATTEMPTS', 3, HARD_LIMITS.maxAttempts),
    eventRetentionDays: envInt(env, 'SKILL_EVENT_RETENTION_DAYS', 30, HARD_LIMITS.eventRetentionDays),
    artifactRetentionDays: envInt(env, 'SKILL_ARTIFACT_RETENTION_DAYS', 90, HARD_LIMITS.artifactRetentionDays),
    packageDataRoot: envPath(env, 'SKILL_PACKAGE_DATA_ROOT', defaultRoot('packages')),
    artifactRoot: envPath(env, 'SKILL_ARTIFACT_ROOT', defaultRoot('runs')),
    exportRoot: envPath(env, 'SKILL_EXPORT_ROOT', defaultRoot('exports')),
    maxPackageBytes: envInt(env, 'SKILL_MAX_PACKAGE_BYTES', 100 * 1024 * 1024, HARD_LIMITS.maxPackageBytes),
    maxPackageFiles: envInt(env, 'SKILL_MAX_PACKAGE_FILES', 10_000, HARD_LIMITS.maxPackageFiles),
    maxFileBytes: envInt(env, 'SKILL_MAX_FILE_BYTES', 10 * 1024 * 1024, HARD_LIMITS.maxFileBytes),
    maxRunDurationMs: envInt(env, 'SKILL_MAX_RUN_DURATION_MS', 30 * 60 * 1000, HARD_LIMITS.maxRunDurationMs),
    githubRequestTimeoutMs: envInt(env, 'SKILL_GITHUB_REQUEST_TIMEOUT_MS', 15_000, HARD_LIMITS.githubRequestTimeoutMs),
    githubMaxArchiveBytes: envInt(env, 'SKILL_GITHUB_MAX_ARCHIVE_BYTES', 100 * 1024 * 1024, HARD_LIMITS.githubMaxArchiveBytes),
    githubAllowedHosts: envList(env, 'SKILL_GITHUB_ALLOWED_HOSTS', ['github.com', 'api.github.com', 'codeload.github.com']),
  }
  return assertSkillRuntimeConfig(config, fsAdapter)
}

const FIELD_TO_ENV_KEY: Readonly<Record<SkillRuntimeSettingField, string>> = {
  runtimeEnabled: 'SKILL_RUNTIME_ENABLED',
  packageExecutionEnabled: 'SKILL_PACKAGE_EXECUTION_ENABLED',
  importEnabled: 'SKILL_PACKAGE_IMPORT_ENABLED',
  githubImportEnabled: 'SKILL_GITHUB_IMPORT_ENABLED',
  npxImportEnabled: 'SKILL_NPX_IMPORT_ENABLED',
  creatorEnabled: 'SKILL_CREATOR_ENABLED',
  creatorPublishEnabled: 'SKILL_CREATOR_PUBLISH_ENABLED',
  workerConcurrency: 'SKILL_WORKER_CONCURRENCY',
  leaseTimeoutMs: 'SKILL_LEASE_TIMEOUT_MS',
  maxAttempts: 'SKILL_MAX_ATTEMPTS',
  eventRetentionDays: 'SKILL_EVENT_RETENTION_DAYS',
  artifactRetentionDays: 'SKILL_ARTIFACT_RETENTION_DAYS',
  maxPackageBytes: 'SKILL_MAX_PACKAGE_BYTES',
  maxPackageFiles: 'SKILL_MAX_PACKAGE_FILES',
  maxFileBytes: 'SKILL_MAX_FILE_BYTES',
  maxRunDurationMs: 'SKILL_MAX_RUN_DURATION_MS',
  githubRequestTimeoutMs: 'SKILL_GITHUB_REQUEST_TIMEOUT_MS',
  githubMaxArchiveBytes: 'SKILL_GITHUB_MAX_ARCHIVE_BYTES',
  githubAllowedHosts: 'SKILL_GITHUB_ALLOWED_HOSTS',
}

const NUMERIC_SETTING_LIMITS: Readonly<Partial<Record<SkillRuntimeSettingField, number>>> = {
  workerConcurrency: HARD_LIMITS.workerConcurrency,
  leaseTimeoutMs: HARD_LIMITS.leaseTimeoutMs,
  maxAttempts: HARD_LIMITS.maxAttempts,
  eventRetentionDays: HARD_LIMITS.eventRetentionDays,
  artifactRetentionDays: HARD_LIMITS.artifactRetentionDays,
  maxPackageBytes: HARD_LIMITS.maxPackageBytes,
  maxPackageFiles: HARD_LIMITS.maxPackageFiles,
  maxFileBytes: HARD_LIMITS.maxFileBytes,
  maxRunDurationMs: HARD_LIMITS.maxRunDurationMs,
  githubRequestTimeoutMs: HARD_LIMITS.githubRequestTimeoutMs,
  githubMaxArchiveBytes: HARD_LIMITS.githubMaxArchiveBytes,
}

function readSkillRuntimeOverrides(): Partial<Record<SkillRuntimeSettingField, string>> {
  try {
    const values = settingsRepo.list()
    const overrides: Partial<Record<SkillRuntimeSettingField, string>> = {}
    for (const field of SKILL_RUNTIME_SETTING_FIELDS) {
      const value = values[`skill_runtime.${field}`]
      if (value !== undefined) overrides[field] = value
    }
    return overrides
  } catch {
    // The config module is also used during first-startup and in migration
    // tests before the SQLite handle exists. Environment config remains the
    // safe fallback in that state.
    return {}
  }
}

function applySkillRuntimeOverrides(
  config: SkillRuntimeConfig,
  overrides: Partial<Record<SkillRuntimeSettingField, string>>,
  fsAdapter: SkillRuntimeFsAdapter,
): SkillRuntimeConfig {
  const next = { ...config }
  for (const field of SKILL_RUNTIME_SETTING_FIELDS) {
    const raw = overrides[field]
    if (raw === undefined) continue
    const envKey = FIELD_TO_ENV_KEY[field]
    if (field === 'githubAllowedHosts') {
      next[field] = envList({ [envKey]: raw }, envKey, next[field]) as never
      continue
    }
    if (field in NUMERIC_SETTING_LIMITS) {
      const max = NUMERIC_SETTING_LIMITS[field]
      if (max === undefined) throw new SkillRuntimeConfigError(`No hard limit configured for ${field}`)
      next[field] = envInt({ [envKey]: raw }, envKey, next[field] as number, max) as never
      continue
    }
    next[field] = envBool({ [envKey]: raw }, envKey, next[field] as boolean) as never
  }
  return assertSkillRuntimeConfig(next, fsAdapter)
}

export function loadSkillRuntimeConfig(
  env: SkillRuntimeConfigEnv = process.env,
  fsAdapter: SkillRuntimeFsAdapter = fs,
): SkillRuntimeConfig {
  const base = loadSkillRuntimeConfigFromEnv(env, fsAdapter)
  // Explicit test/config environments must be deterministic and must not be
  // contaminated by the process application's persisted settings database.
  if (env !== process.env) return base
  return applySkillRuntimeOverrides(base, readSkillRuntimeOverrides(), fsAdapter)
}

let cachedConfig: SkillRuntimeConfig | undefined
let cachedEnvFingerprint: string | undefined

function runtimeEnvFingerprint(): string {
  const keys = [
    'SKILL_RUNTIME_ENABLED', 'SKILL_PACKAGE_RUNTIME_ENABLED', 'SKILL_PACKAGE_EXECUTION_ENABLED',
    'SKILL_LEGACY_LIFECYCLE', 'SKILL_LEGACY_READ_ONLY', 'SKILL_LEGACY_EXECUTION_ENABLED',
    'SKILL_PACKAGE_IMPORT_ENABLED', 'SKILL_GITHUB_IMPORT_ENABLED', 'SKILL_NPX_IMPORT_ENABLED',
    'SKILL_CREATOR_ENABLED', 'SKILL_CREATOR_PUBLISH_ENABLED', 'SKILL_WORKER_CONCURRENCY',
    'SKILL_LEASE_TIMEOUT_MS', 'SKILL_MAX_ATTEMPTS', 'SKILL_EVENT_RETENTION_DAYS',
    'SKILL_ARTIFACT_RETENTION_DAYS', 'SKILL_PACKAGE_DATA_ROOT', 'SKILL_ARTIFACT_ROOT',
    'SKILL_EXPORT_ROOT', 'SKILL_MAX_PACKAGE_BYTES', 'SKILL_MAX_PACKAGE_FILES',
    'SKILL_MAX_FILE_BYTES', 'SKILL_MAX_RUN_DURATION_MS', 'SKILL_GITHUB_REQUEST_TIMEOUT_MS',
    'SKILL_GITHUB_MAX_ARCHIVE_BYTES', 'SKILL_GITHUB_ALLOWED_HOSTS', 'DATA_DIR',
  ]
  return keys.map((key) => `${key}=${process.env[key] ?? ''}`).join('|')
}

export function getSkillRuntimeConfig(): SkillRuntimeConfig {
  const fingerprint = runtimeEnvFingerprint()
  if (!cachedConfig || cachedEnvFingerprint !== fingerprint) {
    cachedConfig = loadSkillRuntimeConfig()
    cachedEnvFingerprint = fingerprint
  }
  return cachedConfig
}

export function invalidateSkillRuntimeConfigCache(): void {
  cachedConfig = undefined
  cachedEnvFingerprint = undefined
}

export function setSkillRuntimeConfigForTests(config: SkillRuntimeConfig | undefined): void {
  cachedConfig = config
  cachedEnvFingerprint = config ? runtimeEnvFingerprint() : undefined
}

export function getSkillRuntimeOperationalStatus(config = getSkillRuntimeConfig()): SkillRuntimeOperationalSnapshot {
  if (!config.runtimeEnabled) {
    return {
      status: 'disabled',
      reason: 'runtime_disabled',
      canManage: false,
      canExecute: false,
    }
  }

  if (!config.packageExecutionEnabled) {
    return {
      status: 'degraded',
      reason: 'package_execution_disabled',
      canManage: true,
      canExecute: false,
    }
  }

  return {
    status: 'ready',
    reason: 'runtime_ready',
    canManage: true,
    canExecute: true,
  }
}

export function getSkillRuntimeCapabilities(config = getSkillRuntimeConfig()): SkillRuntimeCapabilities {
  const operational = getSkillRuntimeOperationalStatus(config)
  return {
    operationalStatus: operational.status,
    statusReason: operational.reason,
    canManage: operational.canManage,
    canExecute: operational.canExecute,
    sourcePolicy: {
      allowedKinds: [...SKILL_RUNTIME_SOURCE_KINDS],
    },
    capabilityPolicy: {
      allowedCapabilities: [...skillCapabilitySchema.options],
    },
    protocolVersion: config.protocolVersion,
    configVersion: config.configVersion,
    runtimeEnabled: config.runtimeEnabled,
    packageExecutionEnabled: config.packageExecutionEnabled,
    legacyLifecycle: config.legacyLifecycle,
    legacyReadOnly: config.legacyReadOnly,
    legacyExecutionEnabled: config.legacyExecutionEnabled,
    importEnabled: config.importEnabled,
    githubImportEnabled: config.githubImportEnabled,
    npxImportEnabled: config.npxImportEnabled,
    creatorEnabled: config.creatorEnabled,
    creatorPublishEnabled: config.creatorPublishEnabled,
    limits: {
      workerConcurrency: config.workerConcurrency,
      leaseTimeoutMs: config.leaseTimeoutMs,
      maxAttempts: config.maxAttempts,
      eventRetentionDays: config.eventRetentionDays,
      artifactRetentionDays: config.artifactRetentionDays,
      maxPackageBytes: config.maxPackageBytes,
      maxPackageFiles: config.maxPackageFiles,
      maxFileBytes: config.maxFileBytes,
      maxRunDurationMs: config.maxRunDurationMs,
      githubRequestTimeoutMs: config.githubRequestTimeoutMs,
      githubMaxArchiveBytes: config.githubMaxArchiveBytes,
      githubAllowedHosts: [...config.githubAllowedHosts],
    },
  }
}

export function assertSkillRuntimeFeature(
  feature: keyof Pick<SkillRuntimeConfig, 'runtimeEnabled' | 'packageExecutionEnabled' | 'importEnabled' | 'githubImportEnabled' | 'npxImportEnabled' | 'creatorEnabled' | 'creatorPublishEnabled'>,
  config = getSkillRuntimeConfig(),
): void {
  if (!config[feature]) throw new SkillRuntimeFeatureDisabledError(feature)
}

export function ensureSkillRuntimeDirectories(config = getSkillRuntimeConfig()): void {
  fs.mkdirSync(config.packageDataRoot, { recursive: true })
  fs.mkdirSync(config.artifactRoot, { recursive: true })
  fs.mkdirSync(config.exportRoot, { recursive: true })
}
