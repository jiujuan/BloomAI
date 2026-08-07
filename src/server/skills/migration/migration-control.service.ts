import { toLegacySkillReference, toPackageSkillReference } from '../../../shared/skill-references'
import { ServiceError } from '../../services/errors'
import { legacySkillAdapter, type LegacySkillAdapter, type LegacySkillView } from '../application/legacy-skill.adapter'
import { createSkillDraftService } from '../creator/skill-draft.service'
import { createMigrationPreviewService, type MigrationPreviewService } from './migration-preview.service'
import { legacyMigrationRepo, type LegacyMigrationRecord } from '../../db/repositories/legacy-migration.repo'
import { createSqlitePackageRepository } from '../../db/repositories/skill-package.repo'
import type { PackageSkillRepository } from '../application/ports'
import type { DraftCandidate, MigrationPreview } from './migration.types'
import { MIGRATION_ERROR_CODES } from './migration-errors'
import { recordMigrationMetric } from '../observability/skill-runtime.metrics'

const DEFAULT_OWNER = 'local-user'

type MigrationRecordPort = Pick<typeof legacyMigrationRepo, 'get' | 'findBySource' | 'listByLegacySkill' | 'createPreview' | 'updateValidation' | 'markPublished'>
type PublishedPackagePort = Pick<PackageSkillRepository, 'getPackage' | 'getVersion' | 'listInstallations'>
type DraftServicePort = {
  createDraft(input: { ownerId: string; content: unknown; baseVersionId?: string }): any
  getDraft(id: string, ownerId: string): any
  validateDraft(id: string, ownerId: string): any
  publishDraft(id: string, ownerId: string, options?: Record<string, unknown>): any
}
type MigrationControlDependencies = {
  legacy?: Pick<LegacySkillAdapter, 'getRaw' | 'get'>
  preview?: MigrationPreviewService
  migrations?: MigrationRecordPort
  drafts?: DraftServicePort
  packages?: PublishedPackagePort
}

export type MigrationContext = { ownerId?: string; actor?: string }
export type MigrationPublishInput = {
  previewId: string
  expectedRevision: number
  confirm: boolean
  acknowledgedWarnings?: string[]
}

export function createMigrationControlService(overrides: MigrationControlDependencies = {}) {
  const legacy = overrides.legacy ?? legacySkillAdapter
  const previewService = overrides.preview ?? createMigrationPreviewService()
  const migrations = overrides.migrations ?? legacyMigrationRepo
  const drafts = overrides.drafts ?? createSkillDraftService() as unknown as DraftServicePort
  const packages = overrides.packages ?? createSqlitePackageRepository()

  function owner(context: MigrationContext = {}): string {
    return context.ownerId?.trim() || DEFAULT_OWNER
  }

  function sourceFor(reference: string): LegacySkillView {
    return legacy.get(reference)
  }

  function sourceEnvelope(skill: LegacySkillView): Record<string, unknown> {
    return {
      legacySkillId: skill.id,
      id: skill.id,
      type: skill.type,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      source: skill.source,
      params_schema: skill.params_schema,
      metadata: { author: skill.author },
    }
  }

  function inspect(reference: string, context: MigrationContext = {}) {
    const skill = sourceFor(reference)
    const result = previewService.inspect(sourceEnvelope(skill))
    return withContext(result, skill, context)
  }

  function preview(reference: string, context: MigrationContext = {}) {
    const skill = sourceFor(reference)
    const result = previewService.preview(sourceEnvelope(skill))
    recordMigrationMetric(migrationMetricForResult(result))
    const record = migrations.createPreview({
      legacySkillId: skill.id,
      legacyType: skill.type,
      sourceSha256: result.sourceSha256,
      decision: toRecordDecision(result),
      status: toRecordStatus(result),
      ownerId: owner(context),
      createdBy: context.actor?.trim() || owner(context),
      preview: result as unknown as Record<string, unknown>,
      warnings: warningsFromResult(result),
      sideEffects: sideEffectsFromResult(result),
    })
    return withRecord(result, record, skill, context)
  }

  function validate(reference: string, input: { previewId: string; expectedRevision: number }, context: MigrationContext = {}) {
    const skill = sourceFor(reference)
    const record = requireOwnedRecord(migrations.get(input.previewId), owner(context), input.previewId)
    assertRevision(record, input.expectedRevision)
    const result = previewService.preview(sourceEnvelope(skill))
    assertCurrentSource(record, result)
    if (result.result.kind !== 'package-draft-candidate' || result.result.decision !== 'auto_convertible') {
      throw migrationDecisionError(result)
    }

    const candidate = result.result
    const priorPreview = isRecord(record.preview) ? record.preview : {}
    let draftId = typeof priorPreview.draftId === 'string' ? priorPreview.draftId : undefined
    if (draftId) {
      const existingDraft = drafts.getDraft(draftId, owner(context))
      if (!existingDraft) draftId = undefined
    }
    if (!draftId) {
      const draft = drafts.createDraft({ ownerId: owner(context), content: candidate.content })
      draftId = String(draft.id)
    }
    const validation = drafts.validateDraft(draftId, owner(context))
    const nextPreview = { ...result, draftId, validation } as unknown as Record<string, unknown>
    const nextRecord = migrations.updateValidation({
      id: record.id,
      ownerId: owner(context),
      expectedRevision: input.expectedRevision,
      status: 'migration_previewed',
      decision: 'auto_convertible',
      preview: nextPreview,
      warnings: warningsFromResult(result),
      sideEffects: { ...sideEffectsFromResult(result), database: true },
      lastError: validation.valid ? null : 'Package draft validation failed',
    })
    if (!nextRecord) throw new ServiceError('REVISION_CONFLICT', 'Migration preview revision conflict', { currentRevision: record.revision })
    return {
      ...withRecord(result, nextRecord, skill, context),
      valid: validation.valid,
      errors: validation.errors,
      warnings: [...warningsFromResult(result), ...validation.warnings],
      requiredCapabilities: candidate.manifest.capabilities,
      draftId,
      revision: nextRecord.revision,
    }
  }

  function publish(reference: string, input: MigrationPublishInput, context: MigrationContext = {}) {
    const skill = sourceFor(reference)
    const record = requireOwnedRecord(migrations.get(input.previewId), owner(context), input.previewId)
    assertRevision(record, input.expectedRevision)
    if (!input.confirm) throw new ServiceError('VALIDATION_ERROR', 'Migration publish requires confirm=true')
    const result = previewService.preview(sourceEnvelope(skill))
    assertCurrentSource(record, result)
    if (result.result.kind !== 'package-draft-candidate' || result.result.decision !== 'auto_convertible') throw migrationDecisionError(result)

    // A published migration is an immutable mapping. Retries must return the
    // original Package/Version/Installation without touching the Draft or
    // creating any new records, even when the first publish skipped validate.
    if (record.status === 'migration_published') {
      return publishedMigrationResult(record, skill.id, packages)
    }

    const warnings = warningsFromResult(result)
    const acknowledged = new Set(input.acknowledgedWarnings ?? [])
    const missingWarnings = warnings.map((warning) => warning.code).filter((code) => !acknowledged.has(code))
    if (missingWarnings.length) throw new ServiceError('CONFLICT', 'Migration warnings must be acknowledged before publish', { missingWarnings: missingWarnings.join(',') })

    const previewPayload = isRecord(record.preview) ? record.preview : {}
    let draftId = typeof previewPayload.draftId === 'string' ? previewPayload.draftId : undefined
    if (!draftId) {
      const draft = drafts.createDraft({ ownerId: owner(context), content: result.result.content })
      draftId = String(draft.id)
      const validation = drafts.validateDraft(draftId, owner(context))
      if (!validation.valid) throw new ServiceError('PACKAGE_INSTALL_ERROR', 'Migrated draft validation failed', { errorCount: validation.errors.length })
    }
    let published
    try {
      published = drafts.publishDraft(draftId, owner(context), {
        enable: false,
        legacyMigration: {
        legacySkillId: skill.id,
        sourceSha256: result.sourceSha256,
        ownerId: owner(context),
        createdBy: context.actor?.trim() || owner(context),
        decision: 'auto_convertible',
        previewId: record.id,
          expectedRevision: input.expectedRevision,
        },
      })
    } catch (error) {
      recordMigrationMetric('migration_transaction_rolled_back')
      throw error
    }
    const nextRecord = migrations.get(record.id)
    if (!nextRecord || nextRecord.status !== 'migration_published') {
      throw new ServiceError('INTERNAL_ERROR', 'Migration publish transaction did not produce a published mapping')
    }
    recordMigrationMetric('migration_published')
    return {
      migrationId: nextRecord.id,
      legacySkillId: skill.id,
      legacyReference: toLegacySkillReference(skill.id),
      packageId: published.packageId,
      packageReference: toPackageSkillReference(String(published.packageId)),
      skillVersionId: published.versionId,
      installationId: published.installationId,
      lifecycle: 'migration_published' as const,
      readOnly: true as const,
      revision: nextRecord.revision,
    }
  }

  function history(reference: string) {
    const skill = sourceFor(reference)
    return migrations.listByLegacySkill(skill.id).map((record) => ({
      ...record,
      legacyReference: toLegacySkillReference(skill.id),
      packageReference: record.packageId ? toPackageSkillReference(record.packageId) : null,
      readOnly: true,
    }))
  }

  return { inspect, preview, validate, publish, history }
}

export const migrationControlService = createMigrationControlService()

function publishedMigrationResult(record: LegacyMigrationRecord, legacySkillId: string, packages: PublishedPackagePort) {
  if (!record.packageId || !record.packageVersionId) {
    throw new ServiceError('INTERNAL_ERROR', 'Published migration is missing Package provenance')
  }
  const packageRecord = packages.getPackage(record.packageId)
  const version = packages.getVersion(record.packageVersionId)
  if (!packageRecord || !version || version.packageId !== packageRecord.id) {
    throw new ServiceError('INTERNAL_ERROR', 'Published migration has inconsistent Package provenance')
  }
  const installation = packages.listInstallations(packageRecord.id).find((candidate) => candidate.currentVersionId === version.id)
  if (!installation) {
    throw new ServiceError('INTERNAL_ERROR', 'Published migration is missing its Package installation')
  }
  return {
    migrationId: record.id,
    legacySkillId,
    legacyReference: toLegacySkillReference(legacySkillId),
    packageId: packageRecord.id,
    packageReference: toPackageSkillReference(packageRecord.id),
    skillVersionId: version.id,
    installationId: installation.id,
    lifecycle: 'migration_published' as const,
    readOnly: true as const,
    revision: record.revision,
  }
}

function withContext(result: MigrationPreview, skill: LegacySkillView, context: MigrationContext) {
  return { ...result, legacyReference: toLegacySkillReference(skill.id), runtimeKind: 'legacy' as const, lifecycle: result.lifecycle, readOnly: true as const, ownerId: context.ownerId?.trim() || DEFAULT_OWNER }
}

function withRecord(result: MigrationPreview, record: LegacyMigrationRecord, skill: LegacySkillView, context: MigrationContext) {
  return { ...withContext(result, skill, context), migrationId: record.id, revision: record.revision, status: record.status, decision: record.decision }
}

function migrationMetricForResult(result: MigrationPreview): 'migration_previewed' | 'migration_manual_review' | 'migration_critical_blocked' {
  if (result.result.decision === 'manual_review') return 'migration_manual_review'
  if (result.result.decision === 'critical_blocked') return 'migration_critical_blocked'
  return 'migration_previewed'
}

function toRecordDecision(result: MigrationPreview) {
  return result.result.decision
}

function toRecordStatus(result: MigrationPreview) {
  if (result.result.decision === 'manual_review') return 'manual_review_required' as const
  if (result.result.decision === 'critical_blocked' || result.result.decision === 'unsupported') return 'migration_blocked' as const
  return 'migration_previewed' as const
}

function warningsFromResult(result: MigrationPreview): Array<{ code: string; message: string }> {
  if (result.result.kind === 'package-draft-candidate') return [...result.result.warnings]
  return []
}

function sideEffectsFromResult(result: MigrationPreview): Record<string, unknown> {
  return result.result.sideEffects as unknown as Record<string, unknown>
}

function requireOwnedRecord(record: LegacyMigrationRecord | undefined, ownerId: string, id: string): LegacyMigrationRecord {
  if (!record) throw new ServiceError('NOT_FOUND', `Migration preview not found: ${id}`)
  if (record.ownerId !== ownerId) throw new ServiceError('FORBIDDEN', 'Migration owner does not match')
  return record
}

function assertRevision(record: LegacyMigrationRecord, expectedRevision: number): void {
  if (!Number.isInteger(expectedRevision) || record.revision !== expectedRevision) throw new ServiceError('REVISION_CONFLICT', 'Migration preview revision conflict', { currentRevision: record.revision })
}

function assertCurrentSource(record: LegacyMigrationRecord, result: MigrationPreview): void {
  if (record.sourceSha256 !== result.sourceSha256) throw new ServiceError('REVISION_CONFLICT', 'Legacy source changed after preview', { expectedSourceSha256: record.sourceSha256, currentSourceSha256: result.sourceSha256 })
}

function migrationDecisionError(result: MigrationPreview): ServiceError {
  if (result.result.decision === 'manual_review') return new ServiceError('LEGACY_MIGRATION_MANUAL_REVIEW', MIGRATION_ERROR_CODES.MANUAL_REVIEW)
  if (result.result.decision === 'critical_blocked') return new ServiceError('LEGACY_MIGRATION_CRITICAL_BLOCKED', MIGRATION_ERROR_CODES.CRITICAL_BLOCKED)
  return new ServiceError('LEGACY_MIGRATION_UNSUPPORTED_TYPE', MIGRATION_ERROR_CODES.UNSUPPORTED_TYPE)
}

function isRecord(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value) }
