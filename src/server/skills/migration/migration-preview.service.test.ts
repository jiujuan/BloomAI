import { describe, expect, it } from 'vitest'
import { createMigrationPreviewService } from './migration-preview.service'

describe('migration preview service', () => {
  it('is pure-read and idempotent by legacySkillId plus canonical source hash', () => {
    const service = createMigrationPreviewService()
    const input = { legacySkillId: 'p1', type: 'prompt-template', name: 'Writer', source: 'Hello {{name}}' }
    const first = service.preview(input)
    const second = service.preview({ source: 'Hello {{name}}', name: 'Writer', type: 'prompt-template', id: 'p1' })
    expect(first).toEqual(second)
    expect(first.readOnly).toBe(true)
    expect(first.idempotencyKey).toBe(`p1:${first.sourceSha256}`)
    expect(first.result.kind).toBe('package-draft-candidate')
  })

  it('routes HTTP, JavaScript, unknown, and damaged input to safe non-executable results', () => {
    const service = createMigrationPreviewService()
    expect(service.preview({ id: 'h1', type: 'http-api', source: 'https://example.test' }).result.kind).toBe('manual-review-report')
    expect(service.preview({ id: 'j1', type: 'js-function', source: 'function run() {}' }).result.kind).toBe('critical-blocked-report')
    expect(service.preview({ id: 'u1', type: 'future-type', source: 'x' }).result).toMatchObject({ kind: 'unsupported-report', decision: 'unsupported' })
    expect(service.preview({ id: 'd1', type: 'prompt-template', source: 'x', params_schema: '{bad' }).result).toMatchObject({ kind: 'unsupported-report', decision: 'unsupported' })
  })
})
