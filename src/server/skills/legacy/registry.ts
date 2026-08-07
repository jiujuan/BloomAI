import { getSkillRuntimeConfig } from '../config/skill-runtime.config'
import { ServiceError } from '../../services/errors'

/** The Legacy plane is an archive only; it does not expose executable runners. */
export const legacyArchiveRegistry = Object.freeze({
  dataPlane: 'legacy' as const,
  lifecycle: 'read-only' as const,
  readOnly: true as const,
})

export function assertLegacyReadOnly(): void {
  const config = getSkillRuntimeConfig()
  if (!config.legacyReadOnly && config.legacyLifecycle === 'active') {
    return
  }
  throw new ServiceError('LEGACY_SKILL_FROZEN', 'Legacy Skills are frozen and read-only')
}

export function assertLegacyRunDisabled(): void {
  const config = getSkillRuntimeConfig()
  if (config.legacyExecutionEnabled && config.legacyLifecycle === 'active' && !config.legacyReadOnly) {
    return
  }
  throw new ServiceError('LEGACY_SKILL_RUN_DISABLED', 'Legacy Skill execution is disabled')
}
