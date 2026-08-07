import { describe, expect, it, vi } from 'vitest'
import { createMigrationControlService } from './migration-control.service'
import { createMigrationPreviewService } from './migration-preview.service'
import type { LegacyMigrationRecord } from '../../db/repositories/legacy-migration.repo'

function legacySkill(source = 'Hello {{name}}') {
  return {
    id: 'legacy-prompt-1',
    name: 'Greeting',
    description: 'A greeting template',
    type: 'prompt-template',
    version: '1.0.0',
    source,
    params_schema: { type: 'object' },
    author: 'migration-test',
    runtimeKind: 'legacy',
    lifecycle: 'read-only',
    readOnly: true,
    capabilityProfile: {
      runtimeKind: 'legacy',
      capabilities: ['legacy.prompt-template'],
      riskLevel: 'medium',
      canConvertToPackage: true,
      blockers: [],
      recommendation: 'migrate',
    },
  } as any
}

function createHarness(options: { source?: string; ownerId?: string; type?: string } = {}) {
  let source = options.source ?? 'Hello {{name}}'
  const type = options.type ?? 'prompt-template'
  const records = new Map<string, LegacyMigrationRecord>()
  let recordSequence = 0
  const publishDraft = vi.fn((_draftId: string, _ownerId: string, migrationOptions?: any) => {
    const record = records.get(migrationOptions.legacyMigration.previewId)!
    const now = Date.now()
    const published: LegacyMigrationRecord = {
      ...record,
      status: 'migration_published',
      packageId: 'package-1',
      packageVersionId: 'version-1',
      publishedAt: now,
      updatedAt: now,
      revision: migrationOptions.legacyMigration.expectedRevision + 1,
      lastError: null,
    }
    records.set(record.id, published)
    return { packageId: 'package-1', versionId: 'version-1', installationId: 'installation-1' }
  })
  const migrations = {
    get: (id: string) => records.get(id),
    findBySource: vi.fn(),
    listByLegacySkill: (legacySkillId: string) => [...records.values()].filter((record) => record.legacySkillId === legacySkillId),
    createPreview: (input: any) => {
      const existing = [...records.values()].find((record) => record.legacySkillId === input.legacySkillId && record.sourceSha256 === input.sourceSha256)
      if (existing) return existing
      const now = Date.now()
      const record: LegacyMigrationRecord = {
        id: `migration-${++recordSequence}`,
        legacySkillId: input.legacySkillId,
        legacyType: input.legacyType,
        sourceSha256: input.sourceSha256,
        decision: input.decision,
        status: input.status,
        packageId: null,
        packageVersionId: null,
        reportArtifactId: null,
        ownerId: input.ownerId,
        createdBy: input.createdBy,
        preview: input.preview ?? {},
        warnings: input.warnings ?? [],
        sideEffects: input.sideEffects ?? {},
        lastError: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
      }
      records.set(record.id, record)
      return record
    },
    updateValidation: (input: any) => {
      const current = records.get(input.id)
      if (!current || current.revision !== input.expectedRevision) return undefined
      const next = { ...current, ...input, revision: current.revision + 1, updatedAt: Date.now() }
      delete next.id
      const record = { ...current, ...next, id: current.id }
      records.set(current.id, record)
      return record
    },
    markPublished: vi.fn(),
  }
  const drafts = {
    createDraft: vi.fn(({ ownerId }: any) => ({ id: 'draft-1', ownerId, status: 'draft' })),
    getDraft: vi.fn(() => ({ id: 'draft-1', ownerId: options.ownerId ?? 'owner-a', status: 'draft' })),
    validateDraft: vi.fn(() => ({ valid: true, errors: [], warnings: [], manifest: { name: 'Greeting' } })),
    publishDraft,
  }
  const packages = {
    getPackage: vi.fn((id: string) => id === 'package-1' ? { id, name: 'Greeting', description: '', sourceType: 'legacy-migration', sourceUri: 'legacy:legacy-prompt-1', sourceRef: '1.0.0', createdAt: 1, updatedAt: 1 } : undefined),
    getVersion: vi.fn((id: string) => id === 'version-1' ? { id, packageId: 'package-1', version: '1.0.0', runtime: 'instruction-agent', manifest: {}, manifestHash: 'manifest-hash', packagePath: '/packages/greeting', sourceSnapshot: {}, isCompatible: true, createdAt: 1 } : undefined),
    listInstallations: vi.fn(() => [{ id: 'installation-1', packageId: 'package-1', currentVersionId: 'version-1', status: 'disabled', enabled: false, installedAt: 1, updatedAt: 1 }]),
  }
  const service = createMigrationControlService({
    legacy: { getRaw: vi.fn(() => ({ ...legacySkill(source), type })), get: vi.fn(() => ({ ...legacySkill(source), type })) },
    preview: createMigrationPreviewService(),
    migrations: migrations as any,
    drafts,
    packages: packages as any,
  })
  return {
    service,
    records,
    drafts,
    packages,
    setSource(next: string) { source = next },
  }
}

describe('MigrationControlService', () => {
  it('runs prompt-template preview, validation and publish, then retries idempotently', () => {
    const harness = createHarness()
    const preview = harness.service.preview('legacy:legacy-prompt-1', { ownerId: 'owner-a', actor: 'actor-a' })
    expect(preview.result).toMatchObject({ kind: 'package-draft-candidate', decision: 'auto_convertible' })

    const validated = harness.service.validate('legacy:legacy-prompt-1', { previewId: preview.migrationId, expectedRevision: preview.revision }, { ownerId: 'owner-a', actor: 'actor-a' })
    expect(validated.valid).toBe(true)
    expect(validated.draftId).toBe('draft-1')

    const published = harness.service.publish('legacy:legacy-prompt-1', {
      previewId: validated.migrationId,
      expectedRevision: validated.revision,
      confirm: true,
    }, { ownerId: 'owner-a', actor: 'actor-a' })
    expect(published).toMatchObject({ packageId: 'package-1', skillVersionId: 'version-1', installationId: 'installation-1', lifecycle: 'migration_published' })
    expect(harness.drafts.publishDraft).toHaveBeenCalledTimes(1)

    const retry = harness.service.publish('legacy:legacy-prompt-1', {
      previewId: published.migrationId,
      expectedRevision: published.revision,
      confirm: true,
    }, { ownerId: 'owner-a', actor: 'actor-a' })
    expect(retry).toEqual(published)
    expect(harness.drafts.publishDraft).toHaveBeenCalledTimes(1)
    expect(harness.packages.getPackage).toHaveBeenCalledTimes(1)
  })

  it('makes direct publish retries idempotent without creating an orphan draft', () => {
    const harness = createHarness()
    const preview = harness.service.preview('legacy:legacy-prompt-1', { ownerId: 'owner-a' })
    const first = harness.service.publish('legacy:legacy-prompt-1', { previewId: preview.migrationId, expectedRevision: preview.revision, confirm: true }, { ownerId: 'owner-a' })
    const second = harness.service.publish('legacy:legacy-prompt-1', { previewId: first.migrationId, expectedRevision: first.revision, confirm: true }, { ownerId: 'owner-a' })
    expect(second).toEqual(first)
    expect(harness.drafts.createDraft).toHaveBeenCalledTimes(1)
    expect(harness.drafts.publishDraft).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['http-api', 'LEGACY_MIGRATION_MANUAL_REVIEW'],
    ['js-function', 'LEGACY_MIGRATION_CRITICAL_BLOCKED'],
  ] as const)('does not publish %s Legacy Skills', (type, code) => {
    const harness = createHarness({ type, source: type === 'http-api' ? 'https://example.test/api' : 'function run() { return 1 }' })
    const preview = harness.service.preview('legacy:legacy-prompt-1', { ownerId: 'owner-a' })
    expect(preview.result).toMatchObject({ decision: type === 'http-api' ? 'manual_review' : 'critical_blocked' })
    expect(() => harness.service.publish('legacy:legacy-prompt-1', {
      previewId: preview.migrationId,
      expectedRevision: preview.revision,
      confirm: true,
    }, { ownerId: 'owner-a' })).toThrowError(new RegExp(code))
    expect(harness.drafts.publishDraft).not.toHaveBeenCalled()
  })

  it('rejects owner mismatch, stale revisions, source changes, confirm=false and unacknowledged warnings', () => {
    const harness = createHarness({ source: 'Call https://example.test/{{name}}' })
    const preview = harness.service.preview('legacy:legacy-prompt-1', { ownerId: 'owner-a' })
    expect(() => harness.service.publish('legacy:legacy-prompt-1', { previewId: preview.migrationId, expectedRevision: preview.revision, confirm: true }, { ownerId: 'owner-b' })).toThrowError(/owner/i)
    expect(() => harness.service.publish('legacy:legacy-prompt-1', { previewId: preview.migrationId, expectedRevision: preview.revision - 1, confirm: true }, { ownerId: 'owner-a' })).toThrowError(/revision/i)
    expect(() => harness.service.publish('legacy:legacy-prompt-1', { previewId: preview.migrationId, expectedRevision: preview.revision, confirm: false }, { ownerId: 'owner-a' })).toThrowError(/confirm/i)
    expect(() => harness.service.publish('legacy:legacy-prompt-1', { previewId: preview.migrationId, expectedRevision: preview.revision, confirm: true }, { ownerId: 'owner-a' })).toThrowError(/acknowledged/i)
    harness.setSource('Changed {{name}}')
    expect(() => harness.service.publish('legacy:legacy-prompt-1', { previewId: preview.migrationId, expectedRevision: preview.revision, confirm: true, acknowledgedWarnings: ['TEMPLATE_URL'] }, { ownerId: 'owner-a' })).toThrowError(/source changed/i)
  })

  it('fails closed when published Package provenance is missing or inconsistent', () => {
    const harness = createHarness()
    const preview = harness.service.preview('legacy:legacy-prompt-1', { ownerId: 'owner-a' })
    const first = harness.service.publish('legacy:legacy-prompt-1', { previewId: preview.migrationId, expectedRevision: preview.revision, confirm: true }, { ownerId: 'owner-a' })
    harness.packages.getVersion.mockReturnValue(undefined)
    expect(() => harness.service.publish('legacy:legacy-prompt-1', { previewId: first.migrationId, expectedRevision: first.revision, confirm: true }, { ownerId: 'owner-a' })).toThrowError(/provenance/i)
  })
})
