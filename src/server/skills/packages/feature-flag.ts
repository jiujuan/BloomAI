import { getSkillRuntimeConfig } from '../config/skill-runtime.config'

export const skillPackageRuntimeFeatureKey = 'skill_package_runtime_enabled'

/**
 * Backwards-compatible package execution gate. The legacy environment key is
 * parsed by the shared runtime configuration, so all package runtime callers
 * observe the same validated snapshot.
 */
export function isSkillPackageRuntimeEnabled(): boolean {
  const config = getSkillRuntimeConfig()
  return config.runtimeEnabled && config.packageExecutionEnabled
}
