import { settingsRepo } from '../../db/repositories/settings.repo'

export const skillPackageRuntimeFeatureKey = 'skill_package_runtime_enabled'

export function isSkillPackageRuntimeEnabled(): boolean {
  const envValue = process.env.SKILL_PACKAGE_RUNTIME_ENABLED?.trim().toLowerCase()
  if (envValue) return ['1', 'true', 'yes', 'on'].includes(envValue)

  try {
    return settingsRepo.getValue(skillPackageRuntimeFeatureKey) === 'true'
  } catch {
    return false
  }
}
