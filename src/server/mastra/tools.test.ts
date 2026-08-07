import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/repositories/tool.repo', () => ({
  toolRepo: { list: () => [] },
}))
import { buildAgentTools, buildLegacySkillTools, getLegacySkillMigrationHint } from './tools'

describe('Legacy Mastra tool compatibility', () => {
  it('does not register legacy_skill_<id> tools on either tool surface', () => {
    expect(Object.keys(buildLegacySkillTools())).toEqual([])
    expect(Object.keys(buildAgentTools())).not.toContain(expect.stringMatching(/^legacy_skill_/))
  })

  it('returns a structured migration preview hint instead of an executable tool', () => {
    expect(getLegacySkillMigrationHint('legacy:old-skill')).toEqual({
      runtimeKind: 'legacy',
      readOnly: true,
      migrationAction: 'preview',
      reference: 'legacy:old-skill',
      message: expect.stringContaining('read-only'),
    })
  })
})
