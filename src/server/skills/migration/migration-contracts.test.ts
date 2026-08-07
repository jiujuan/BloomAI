import { describe, expect, it } from 'vitest'
import { createMigrationPreviewService } from './migration-preview.service'

describe('migration schemas and status literals', () => {
  it('exposes stable decisions and lifecycles for M3 control integration', () => {
    const service = createMigrationPreviewService()
    expect(service.preview({ id: 'p', type: 'prompt-template', source: 'x' })).toMatchObject({ lifecycle: 'migration_previewed', classification: { decision: 'auto_convertible' } })
    expect(service.preview({ id: 'h', type: 'http-api', source: 'https://example.test' })).toMatchObject({ lifecycle: 'manual_review_required', classification: { decision: 'manual_review' } })
    expect(service.preview({ id: 'j', type: 'js-function', source: 'x' })).toMatchObject({ lifecycle: 'migration_blocked', classification: { decision: 'critical_blocked' } })
  })
})
