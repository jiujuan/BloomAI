import { describe, expect, it } from 'vitest'
import { classifyLegacySkill } from './migration-classifier'

describe('migration classifier', () => {
  it('uses the exact allowlisted type field', () => {
    expect(classifyLegacySkill({ legacySkillId: 'p1', type: 'prompt-template', source: 'Hello {{name}}' })).toMatchObject({ type: 'prompt-template', decision: 'auto_convertible' })
    expect(classifyLegacySkill({ legacySkillId: 'h1', kind: 'http-api', source: '{}' })).toMatchObject({ type: 'http-api', decision: 'manual_review' })
    expect(classifyLegacySkill({ legacySkillId: 'j1', type: 'js-function', source: 'function run() {}' })).toMatchObject({ type: 'js-function', decision: 'critical_blocked' })
  })

  it('fails closed for missing, case-variant, forged, or conflicting type fields', () => {
    for (const input of [
      { legacySkillId: '1', source: 'x' },
      { legacySkillId: '2', type: 'Prompt-Template', source: 'x' },
      { legacySkillId: '3', type: { toString: () => 'prompt-template' }, source: 'x' },
      { legacySkillId: '4', type: 'prompt-template', kind: 'http-api', source: 'x' },
      { legacySkillId: '5', type: 'shell', source: 'x' },
    ]) expect(classifyLegacySkill(input).decision).toBe('unsupported')
  })

  it('does not carry executable or unknown fields into classification output', () => {
    const result = classifyLegacySkill({ legacySkillId: 'safe', type: 'prompt-template', source: 'x', run: () => 'bad', child_process: 'bad' })
    expect(result.acceptedFields).not.toContain('run')
    expect(result).not.toHaveProperty('run')
  })
})
