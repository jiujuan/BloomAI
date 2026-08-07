import { describe, expect, it } from 'vitest'
import {
  getSkillRuntimeCapabilities,
  getSkillRuntimeOperationalStatus,
  loadSkillRuntimeConfig,
} from './skill-runtime.config'

const fsAdapter = { existsSync: () => false }

function config(overrides: Record<string, string> = {}) {
  return loadSkillRuntimeConfig(overrides, fsAdapter)
}

describe('Skills Admin P0 runtime boundary', () => {
  it('exposes an explicit disabled status without exposing local paths', () => {
    const loaded = config({ SKILL_RUNTIME_ENABLED: 'false' })
    expect(getSkillRuntimeOperationalStatus(loaded)).toEqual({
      status: 'disabled',
      reason: 'runtime_disabled',
      canManage: false,
      canExecute: false,
    })

    const capabilities = getSkillRuntimeCapabilities(loaded)
    expect(capabilities.operationalStatus).toBe('disabled')
    expect(capabilities.statusReason).toBe('runtime_disabled')
    expect(capabilities.sourcePolicy.allowedKinds).toEqual(['local-directory', 'zip', 'github-archive'])
    expect(capabilities.capabilityPolicy.allowedCapabilities).toContain('web.fetch')
    expect(capabilities).not.toHaveProperty('packageDataRoot')
    expect(JSON.stringify(capabilities)).not.toMatch(/password|secret|token|credential/i)
  })

  it('uses degraded status when the management runtime is available but execution is disabled', () => {
    const loaded = config()
    expect(getSkillRuntimeOperationalStatus(loaded)).toEqual({
      status: 'degraded',
      reason: 'package_execution_disabled',
      canManage: true,
      canExecute: false,
    })
  })
})
