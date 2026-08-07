import { describe, expect, it } from 'vitest'
import { normalizeLegacySource } from './source-normalizer'

describe('source normalizer', () => {
  it('produces stable canonical JSON and SHA-256 hashes', () => {
    const left = normalizeLegacySource({ legacySkillId: 'p1', type: 'prompt-template', name: 'Writer', source: 'Hello\r\n{{name}}  \n', paramsSchema: { required: ['name'], properties: { name: { type: 'string' } } } })
    const right = normalizeLegacySource({ type: 'prompt-template', id: 'p1', name: 'Writer', source: 'Hello\n{{name}}\n', params_schema: '{"properties":{"name":{"type":"string"}},"required":["name"]}' })
    expect(left.canonicalJson).toBe(right.canonicalJson)
    expect(left.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('uses deterministic defaults and rejects damaged schema', () => {
    const normalized = normalizeLegacySource({ id: 'legacy-1', type: 'prompt-template', source: 'x' })
    expect(normalized.name).toBe('Legacy Skill legacy-1')
    expect(normalized.description).toBe('')
    expect(() => normalizeLegacySource({ id: 'bad', type: 'prompt-template', source: 'x', params_schema: '{not-json}' })).toThrow(/valid JSON/i)
  })

  it('rejects cyclic and overly deep values before hashing', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => normalizeLegacySource({ id: 'cycle', type: 'prompt-template', source: cyclic })).toThrow()
    let deep: unknown = 'x'
    for (let i = 0; i < 30; i++) deep = [deep]
    expect(() => normalizeLegacySource({ id: 'deep', type: 'prompt-template', source: deep })).toThrow()
  })
})
