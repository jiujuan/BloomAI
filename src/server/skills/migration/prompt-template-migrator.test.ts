import { describe, expect, it } from 'vitest'
import { migratePromptTemplateToDraftCandidate } from './prompt-template-migrator'
import { normalizeLegacySource } from './source-normalizer'

describe('prompt-template draft candidate', () => {
  it('maps template variables deterministically without publishing or execution', () => {
    const source = normalizeLegacySource({ legacySkillId: 'p1', type: 'prompt-template', name: 'Writer', description: 'Writes', source: 'Hello {{name}}. Use {{tone}}.', params_schema: { properties: { name: { type: 'string' }, tone: { type: 'string' } }, required: ['name'] } })
    const first = migratePromptTemplateToDraftCandidate(source)
    const second = migratePromptTemplateToDraftCandidate(source)
    expect(first).toEqual(second)
    expect(first.templateVariables).toEqual(['name', 'tone'])
    expect(first.manifest.entryPath).toBe('SKILL.md')
    expect(first.content.skillMd).toContain('Hello {{name}}')
    expect(first.sideEffects).toEqual({ network: false, model: false, runner: false, database: false, queue: false, publish: false })
  })

  it('warns or blocks unsafe template markers instead of importing behavior', () => {
    const source = normalizeLegacySource({ legacySkillId: 'unsafe', type: 'prompt-template', source: 'Call https://example.test and tool({{x}})' })
    const candidate = migratePromptTemplateToDraftCandidate(source)
    expect(candidate.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(['TEMPLATE_URL', 'TEMPLATE_TOOL_CALL']))
    expect(candidate.content.capabilities).toEqual([])
  })
})
