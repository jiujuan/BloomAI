import { skillPackageRepo } from '../db/repositories/skill-package.repo'
import { settingsRepo } from '../db/repositories/settings.repo'
import { ServiceError } from './errors'
import {
  assertSkillRuntimeConfig,
  getSkillRuntimeConfig,
  getSkillRuntimeOperationalStatus,
  invalidateSkillRuntimeConfigCache,
  SKILL_RUNTIME_SETTING_FIELDS,
  type SkillRuntimeConfig,
  type SkillRuntimeSettingField,
} from '../skills/config/skill-runtime.config'

const FEATURE_FLAG_FIELDS = [
  'importEnabled',
  'githubImportEnabled',
  'npxImportEnabled',
  'creatorEnabled',
  'creatorPublishEnabled',
] as const

const RUNTIME_FIELDS = [
  'runtimeEnabled',
  'packageExecutionEnabled',
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

export type SkillRuntimeFeatureFlag = (typeof FEATURE_FLAG_FIELDS)[number]
export type SkillRuntimePublicField = (typeof RUNTIME_FIELDS)[number]
export type SkillRuntimeSettingsDto = {
  runtime: Pick<SkillRuntimeConfig, SkillRuntimePublicField>
  featureFlags: Pick<SkillRuntimeConfig, SkillRuntimeFeatureFlag>
  operational: ReturnType<typeof getSkillRuntimeOperationalStatus>
  protocolVersion: string
  configVersion: string
}

export type SkillRuntimeSettingsPatch = {
  runtime?: Partial<Pick<SkillRuntimeConfig, SkillRuntimePublicField>>
  featureFlags?: Partial<Pick<SkillRuntimeConfig, SkillRuntimeFeatureFlag>>
}

type AuditContext = { actor: string; requestId: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function requirePlainPatch(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new ServiceError('VALIDATION_ERROR', `${label} must be an object`)
  return value
}

function requireBoolean(value: unknown, key: string): boolean {
  if (typeof value !== 'boolean') throw new ServiceError('VALIDATION_ERROR', `${key} must be a boolean`)
  return value
}

function requirePositiveInteger(value: unknown, key: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new ServiceError('VALIDATION_ERROR', `${key} must be a positive integer`)
  }
  return Number(value)
}

function requireHosts(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((host) => typeof host !== 'string' || !host.trim())) {
    throw new ServiceError('VALIDATION_ERROR', `${key} must be a non-empty string array`)
  }
  return [...new Set(value.map((host) => host.trim().toLowerCase()))]
}

function normalizePatch(input: unknown): Required<SkillRuntimeSettingsPatch> {
  if (!isRecord(input)) throw new ServiceError('VALIDATION_ERROR', 'Runtime settings update must be an object')
  const runtimeInput = requirePlainPatch(input.runtime, 'runtime')
  const flagsInput = requirePlainPatch(input.featureFlags, 'featureFlags')
  const allowedTopLevel = new Set(['runtime', 'featureFlags'])
  for (const key of Object.keys(input)) {
    if (!allowedTopLevel.has(key)) throw new ServiceError('VALIDATION_ERROR', `Unknown runtime settings section: ${key}`)
  }

  const runtime: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(runtimeInput)) {
    if (!(RUNTIME_FIELDS as readonly string[]).includes(key)) {
      throw new ServiceError('VALIDATION_ERROR', `Runtime setting is not writable: ${key}`)
    }
    runtime[key] = key === 'runtimeEnabled' || key === 'packageExecutionEnabled'
      ? requireBoolean(value, key)
      : key === 'githubAllowedHosts'
        ? requireHosts(value, key)
        : requirePositiveInteger(value, key)
  }

  const featureFlags: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(flagsInput)) {
    if (!(FEATURE_FLAG_FIELDS as readonly string[]).includes(key)) {
      throw new ServiceError('VALIDATION_ERROR', `Feature flag is not writable: ${key}`)
    }
    featureFlags[key] = requireBoolean(value, key)
  }

  return {
    runtime: runtime as Required<SkillRuntimeSettingsPatch>['runtime'],
    featureFlags: featureFlags as Required<SkillRuntimeSettingsPatch>['featureFlags'],
  }
}

function publicSettings(config: SkillRuntimeConfig): SkillRuntimeSettingsDto {
  const runtime = Object.fromEntries(RUNTIME_FIELDS.map((field) => [field, config[field]])) as SkillRuntimeSettingsDto['runtime']
  const featureFlags = Object.fromEntries(FEATURE_FLAG_FIELDS.map((field) => [field, config[field]])) as SkillRuntimeSettingsDto['featureFlags']
  return {
    runtime,
    featureFlags,
    operational: getSkillRuntimeOperationalStatus(config),
    protocolVersion: config.protocolVersion,
    configVersion: config.configVersion,
  }
}

function getOverrides(): Record<string, string> {
  return Object.fromEntries(Object.entries(settingsRepo.list()).filter(([key]) => key.startsWith('skill_runtime.')))
}

function persistableValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(',')
  return String(value)
}

function toCandidate(config: SkillRuntimeConfig, patch: Required<SkillRuntimeSettingsPatch>): SkillRuntimeConfig {
  try {
    return assertSkillRuntimeConfig({
      ...config,
      ...(patch.runtime ?? {}),
      ...(patch.featureFlags ?? {}),
    })
  } catch (error) {
    throw new ServiceError('VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid runtime settings')
  }
}

function appendAudit(action: string, context: AuditContext, payload: Record<string, unknown>): void {
  skillPackageRepo.appendAudit({
    actor: context.actor,
    action,
    resourceType: 'skill_runtime_settings',
    resourceId: 'skill_runtime',
    securityDecision: 'allowed',
    policyVersion: 'skills-admin-v1.2',
    payload: {
      actor: context.actor,
      requestId: context.requestId,
      securityDecision: 'allowed',
      policyVersion: 'skills-admin-v1.2',
      ...payload,
    },
  })
}

function updateSettings(input: unknown, context: AuditContext): SkillRuntimeSettingsDto {
  const patch = normalizePatch(input)
  const beforeConfig = getSkillRuntimeConfig()
  const before = publicSettings(beforeConfig)
  const beforeOverrides = getOverrides()
  const candidate = toCandidate(beforeConfig, patch)
  const updates: Record<string, string> = {}

  for (const [field, value] of Object.entries({ ...(patch.runtime ?? {}), ...(patch.featureFlags ?? {}) })) {
    if (!(SKILL_RUNTIME_SETTING_FIELDS as readonly string[]).includes(field)) continue
    updates[`skill_runtime.${field}`] = persistableValue(value)
  }
  if (Object.keys(updates).length > 0) settingsRepo.setMany(updates)
  invalidateSkillRuntimeConfigCache()
  const after = publicSettings(getSkillRuntimeConfig())

  appendAudit('skill.runtime.settings.updated', context, {
    before,
    after,
    beforeOverrides,
    afterOverrides: getOverrides(),
  })
  return after
}

export const skillRuntimeSettingsService = {
  get(): SkillRuntimeSettingsDto {
    return publicSettings(getSkillRuntimeConfig())
  },

  getFeatureFlags() {
    const settings = this.get()
    return { featureFlags: settings.featureFlags, operational: settings.operational }
  },

  update(input: unknown, context: AuditContext): SkillRuntimeSettingsDto {
    return updateSettings(input, context)
  },

  updateFeatureFlags(input: unknown, context: AuditContext) {
    const body = isRecord(input) && 'featureFlags' in input ? input : { featureFlags: input }
    const settings = updateSettings(body, context)
    return { featureFlags: settings.featureFlags, operational: settings.operational }
  },

  rollback(context: AuditContext): SkillRuntimeSettingsDto {
    const beforeConfig = getSkillRuntimeConfig()
    const before = publicSettings(beforeConfig)
    const beforeOverrides = getOverrides()
    const keys = SKILL_RUNTIME_SETTING_FIELDS.map((field) => `skill_runtime.${field}`)
    settingsRepo.deleteMany(keys)
    invalidateSkillRuntimeConfigCache()
    const after = publicSettings(getSkillRuntimeConfig())
    appendAudit('skill.runtime.settings.rolled_back', context, {
      before,
      after,
      beforeOverrides,
      afterOverrides: getOverrides(),
    })
    return after
  },
}

export { FEATURE_FLAG_FIELDS, RUNTIME_FIELDS }
