import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDataDir, getDbPath } from '../../db/paths'

export const SKILL_RUNTIME_PROTOCOL_VERSION = '1.1'
export const SKILL_RUNTIME_CONFIG_VERSION = '2026-08-05'

export type SkillRuntimeConfig = {
  protocolVersion: string
  configVersion: string
  runtimeEnabled: boolean
  packageExecutionEnabled: boolean
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
}

export type SkillRuntimeConfigEnv = Record<string, string | undefined>

export type SkillRuntimeFsAdapter = {
  existsSync: (target: string) => boolean
  mkdirSync?: (target: string, options?: { recursive?: boolean }) => void
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
} as const

function envBool(env: SkillRuntimeConfigEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') return fallback
  const normalized = raw.trim().toLowerCase()
  if (BOOL_TRUE.has(normalized)) return true
  if (BOOL_FALSE.has(normalized)) return false
  throw new SkillRuntimeConfigError(`${key} must be a boolean`)
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
  if (config.packageExecutionEnabled && !config.runtimeEnabled) {
    throw new SkillRuntimeConfigError('packageExecutionEnabled requires runtimeEnabled')
  }
  return config
}

export function loadSkillRuntimeConfig(
  env: SkillRuntimeConfigEnv = process.env,
  fsAdapter: SkillRuntimeFsAdapter = fs,
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
  }
  return assertSkillRuntimeConfig(config, fsAdapter)
}

let cachedConfig: SkillRuntimeConfig | undefined
let cachedEnvFingerprint: string | undefined

function runtimeEnvFingerprint(): string {
  const keys = [
    'SKILL_RUNTIME_ENABLED', 'SKILL_PACKAGE_RUNTIME_ENABLED', 'SKILL_PACKAGE_EXECUTION_ENABLED',
    'SKILL_PACKAGE_IMPORT_ENABLED', 'SKILL_GITHUB_IMPORT_ENABLED', 'SKILL_NPX_IMPORT_ENABLED',
    'SKILL_CREATOR_ENABLED', 'SKILL_CREATOR_PUBLISH_ENABLED', 'SKILL_WORKER_CONCURRENCY',
    'SKILL_LEASE_TIMEOUT_MS', 'SKILL_MAX_ATTEMPTS', 'SKILL_EVENT_RETENTION_DAYS',
    'SKILL_ARTIFACT_RETENTION_DAYS', 'SKILL_PACKAGE_DATA_ROOT', 'SKILL_ARTIFACT_ROOT',
    'SKILL_EXPORT_ROOT', 'SKILL_MAX_PACKAGE_BYTES', 'SKILL_MAX_PACKAGE_FILES',
    'SKILL_MAX_FILE_BYTES', 'SKILL_MAX_RUN_DURATION_MS', 'DATA_DIR',
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

export function setSkillRuntimeConfigForTests(config: SkillRuntimeConfig | undefined): void {
  cachedConfig = config
  cachedEnvFingerprint = config ? runtimeEnvFingerprint() : undefined
}

export function getSkillRuntimeCapabilities(config = getSkillRuntimeConfig()): SkillRuntimeCapabilities {
  return {
    protocolVersion: config.protocolVersion,
    configVersion: config.configVersion,
    runtimeEnabled: config.runtimeEnabled,
    packageExecutionEnabled: config.packageExecutionEnabled,
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
