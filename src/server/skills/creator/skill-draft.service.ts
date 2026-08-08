import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ServiceError } from '../../services/errors'
import { getDataDir } from '../../db/paths'
import { skillPackageRepo } from '../../db/repositories/skill-package.repo'
import { resolveManifest } from '../packages/manifest-resolver'
import type { PackageReaderLike } from '../packages/manifest-resolver'
import { skillDraftContentSchema, type SkillDraftContent, type SkillDraftRecord, type SkillDraftValidation } from './skill-draft.schema'

export type LegacyMigrationPublishOptions = {
  legacySkillId: string
  sourceSha256: string
  ownerId: string
  createdBy: string
  decision: 'auto_convertible'
  previewId: string
  expectedRevision: number
  reportArtifactId?: string | null
}

type PackagePublishInput = {
  package: { name: string; description: string; sourceType: string; sourceUri?: string | null; sourceRef?: string | null }
  version: { version: string; manifest: Record<string, unknown>; manifestHash: string; packagePath: string; sourceSnapshot: Record<string, unknown>; isCompatible?: boolean; immutableHash?: string; status?: string; securityStatus?: string; snapshotHash?: string; securityFindings?: Record<string, unknown> }
  snapshot: { filesManifest: Record<string, unknown>; totalBytes: number; fileCount: number; snapshotRoot: string; snapshotHash: string }
  installation: { status: string; enabled?: boolean }
}

type PackagePublishResult = {
  package: { id: string }
  version: { id: string; manifest_hash: string }
  snapshot: { id: string; snapshot_hash: string }
  installation: { id: string; enabled: number }
}

type DraftPublishInput = PackagePublishInput & {
  draft: { id: string; ownerId: string; expectedRevision: number; validation: Record<string, unknown> }
}

type LegacyMigrationTransactionResult = {
  package: { id: string }
  version: { id: string; manifest_hash: string }
  snapshot: { id: string; snapshot_hash: string }
  installation: { id: string; enabled: number }
  migration: { id: string; revision: number }
  idempotent?: boolean
}

export type SkillDraftRepository = {
  createDraft(input: { ownerId: string; content: SkillDraftContent; baseVersionId?: string | null }): SkillDraftRecord
  getDraft(id: string): SkillDraftRecord | undefined
  updateDraftCas(input: { id: string; ownerId: string; expectedRevision: number; content: SkillDraftContent }): SkillDraftRecord | undefined
  saveValidation(input: { id: string; ownerId: string; validation: SkillDraftValidation }): SkillDraftRecord | undefined
  markPublished(input: { id: string; ownerId: string; versionId: string; validation: SkillDraftValidation }): SkillDraftRecord | undefined
  discardDraft(input: { id: string; ownerId: string }): SkillDraftRecord | undefined
  publish(input: PackagePublishInput): PackagePublishResult
  publishDraftTransaction?(input: DraftPublishInput): PackagePublishResult
  publishLegacyMigration?(input: PackagePublishInput & {
    draft: { id: string; ownerId: string; validation: Record<string, unknown> }
    migration: { id: string; ownerId: string; expectedRevision: number; sourceSha256: string; reportArtifactId?: string | null }
    audit: { actor?: string | null; action: string; resourceType: string; resourceId?: string | null; securityDecision?: string; policyVersion?: string; sourceFingerprint?: string | null; payload?: Record<string, unknown> }
  }): LegacyMigrationTransactionResult
}

type DraftServiceOptions = { repo?: SkillDraftRepository; packageDataRoot?: string }
type PublishResult = { draftId: string; packageId: string; versionId: string; snapshotId: string; installationId: string; installationEnabled: boolean; manifestHash: string; snapshotHash: string; migrationId?: string; migrationRevision?: number; idempotent?: boolean }

export function createSkillDraftService(options: DraftServiceOptions = {}) {
  const repo = options.repo ?? createDefaultRepo()
  const packageDataRoot = path.resolve(options.packageDataRoot ?? path.join(getDataDir(), 'skills', 'packages'))

  return {
    createDraft(input: { ownerId: string; content: unknown; baseVersionId?: string }) {
      const ownerId = requireOwner(input.ownerId)
      return repo.createDraft({ ownerId, content: parseContent(input.content), baseVersionId: input.baseVersionId ?? null })
    },
    getDraft(id: string, ownerId: string) {
      const draft = requireOwned(repo, id, ownerId)
      return { ...draft, content: parseContent(draft.content) }
    },
    updateDraft(id: string, ownerId: string, patch: unknown, expectedRevision: number) {
      const draft = requireOwned(repo, id, ownerId)
      if (draft.status === 'discarded') throw new ServiceError('CONFLICT', 'Discarded draft cannot be edited')
      if (draft.status === 'published') throw new ServiceError('CONFLICT', 'Published draft cannot be edited')
      if (!Number.isInteger(expectedRevision) || expectedRevision !== draft.revision) throw new ServiceError('REVISION_CONFLICT', 'Draft revision conflict', { currentRevision: draft.revision })
      const parsedPatch = skillDraftContentSchema.partial().strict().parse(patch)
      const content = parseContent({ ...draft.content, ...parsedPatch })
      const updated = repo.updateDraftCas({ id, ownerId, expectedRevision, content })
      if (!updated) throw new ServiceError('REVISION_CONFLICT', 'Draft revision conflict', { currentRevision: draft.revision })
      return { ...updated, content: parseContent(updated.content) }
    },
    validateDraft(id: string, ownerId: string) {
      const draft = requireOwned(repo, id, ownerId)
      const validation = validateContent(parseContent(draft.content))
      repo.saveValidation({ id, ownerId, validation })
      return validation
    },
    previewDraft(id: string, ownerId: string) {
      const draft = requireOwned(repo, id, ownerId)
      const validation = validateContent(parseContent(draft.content))
      return { draftId: draft.id, revision: draft.revision, published: false, valid: validation.valid, manifest: validation.manifest, files: validation.previewSummary.files, warnings: validation.warnings, errors: validation.errors }
    },
    publishDraft(id: string, ownerId: string, publishOptions: { enable?: boolean; legacyMigration?: LegacyMigrationPublishOptions } = {}): PublishResult {
      const draft = requireOwned(repo, id, ownerId)
      if (draft.status === 'discarded') throw new ServiceError('CONFLICT', 'Discarded draft cannot be published')
      if (draft.status === 'published') throw new ServiceError('CONFLICT', 'Published draft cannot be published again')
      if (publishOptions.legacyMigration && publishOptions.legacyMigration.ownerId !== ownerId) {
        throw new ServiceError('FORBIDDEN', 'Migration owner does not match draft owner')
      }
      const content = parseContent(draft.content)
      const validation = validateContent(content)
      repo.saveValidation({ id, ownerId, validation })
      if (!validation.valid || !validation.manifest) throw new ServiceError('PACKAGE_INSTALL_ERROR', 'Draft validation failed', { errorCount: validation.errors.length })
      const files = buildFiles(content)
      const snapshotHash = hashJson(files)
      const manifestHash = String(validation.manifest.canonicalHash ?? hashJson(validation.manifest))
      const finalPath = path.join(packageDataRoot, `creator-${snapshotHash}`)
      const pathExisted = fs.existsSync(finalPath)
      try {
        materializeFiles(finalPath, files)
        const immutableHash = hashJson({ manifestHash, snapshotHash })
        const packageInput: PackagePublishInput = {
          package: { name: content.name, description: content.description, sourceType: publishOptions.legacyMigration ? 'legacy-migration' : 'creator', sourceUri: publishOptions.legacyMigration ? `legacy:${publishOptions.legacyMigration.legacySkillId}` : `draft:${draft.id}`, sourceRef: content.version },
          version: { version: content.version, manifest: validation.manifest, manifestHash, packagePath: finalPath, sourceSnapshot: { draftId: draft.id, revision: draft.revision, snapshotHash, ...(publishOptions.legacyMigration ? { legacySkillId: publishOptions.legacyMigration.legacySkillId, sourceSha256: publishOptions.legacyMigration.sourceSha256 } : {}) }, isCompatible: validation.errors.length === 0, immutableHash, status: 'runnable', securityStatus: 'approved', snapshotHash },
          snapshot: { filesManifest: files, totalBytes: Object.values(files).reduce((sum, file) => sum + file.sizeBytes, 0), fileCount: Object.keys(files).length, snapshotRoot: finalPath, snapshotHash },
          installation: { status: publishOptions.enable ? 'installed' : 'disabled', enabled: publishOptions.enable === true },
        }

        if (publishOptions.legacyMigration) {
          if (!repo.publishLegacyMigration) throw new ServiceError('PACKAGE_INSTALL_ERROR', 'Legacy migration publish transaction is unavailable')
          const result = repo.publishLegacyMigration({
            ...packageInput,
            draft: { id, ownerId, validation: validation as unknown as Record<string, unknown> },
            migration: { id: publishOptions.legacyMigration.previewId, ownerId, expectedRevision: publishOptions.legacyMigration.expectedRevision, sourceSha256: publishOptions.legacyMigration.sourceSha256, reportArtifactId: publishOptions.legacyMigration.reportArtifactId ?? null },
            audit: {
              actor: publishOptions.legacyMigration.createdBy,
              action: 'legacy_migration.publish',
              resourceType: 'legacy_skill',
              resourceId: publishOptions.legacyMigration.legacySkillId,
              sourceFingerprint: publishOptions.legacyMigration.sourceSha256,
              securityDecision: 'approved',
              policyVersion: 'legacy-migration-v1',
              payload: { migrationId: publishOptions.legacyMigration.previewId, legacySkillId: publishOptions.legacyMigration.legacySkillId },
            },
          })
          return { draftId: id, packageId: result.package.id, versionId: result.version.id, snapshotId: result.snapshot.id, installationId: result.installation.id, installationEnabled: Boolean(result.installation.enabled), manifestHash, snapshotHash, migrationId: result.migration.id, migrationRevision: Number(result.migration.revision), idempotent: result.idempotent === true }
        }

        if (!repo.publishDraftTransaction) throw new ServiceError('PACKAGE_INSTALL_ERROR', 'Creator publish transaction is unavailable')
        const result = repo.publishDraftTransaction({
          ...packageInput,
          draft: { id, ownerId, expectedRevision: draft.revision, validation: validation as unknown as Record<string, unknown> },
        })
        return { draftId: id, packageId: result.package.id, versionId: result.version.id, snapshotId: result.snapshot.id, installationId: result.installation.id, installationEnabled: Boolean(result.installation.enabled), manifestHash, snapshotHash }
      } catch (error) {
        if (!pathExisted) {
          try { fs.rmSync(finalPath, { recursive: true, force: true }) } catch { /* best-effort cleanup after DB rollback */ }
        }
        if (error instanceof ServiceError) throw error
        throw new ServiceError('PACKAGE_INSTALL_ERROR', error instanceof Error ? error.message : 'Draft publish failed')
      }
    },
    discardDraft(id: string, ownerId: string) {
      return requireOwned(repo, id, ownerId) && repo.discardDraft({ id, ownerId })
    },
  }
}

function createDefaultRepo(): SkillDraftRepository {
  return {
    createDraft(input) { return mapDraft(skillPackageRepo.createDraft(input)) },
    getDraft(id) { const row = skillPackageRepo.getDraft(id); return row ? mapDraft(row) : undefined },
    updateDraftCas(input) { const row = skillPackageRepo.updateDraftCas(input); return row ? mapDraft(row) : undefined },
    saveValidation(input) { const row = skillPackageRepo.saveDraftValidation(input); return row ? mapDraft(row) : undefined },
    markPublished(input) { const row = skillPackageRepo.markDraftPublished(input); return row ? mapDraft(row) : undefined },
    discardDraft(input) { const row = skillPackageRepo.discardDraft(input); return row ? mapDraft(row) : undefined },
    publish(input) { return skillPackageRepo.createPackageVersionInstallationTransaction(input) as any },
    publishDraftTransaction(input) { return skillPackageRepo.publishDraftTransaction(input) as any },
    publishLegacyMigration(input) { return skillPackageRepo.publishLegacyMigrationTransaction(input) as any },
  }
}

function mapDraft(row: any): SkillDraftRecord {
  return { id: row.id, ownerId: row.owner_id, status: row.status, revision: row.revision, content: JSON.parse(row.content_json), validation: JSON.parse(row.validation_json || 'null'), baseVersionId: row.base_version_id, publishedVersionId: row.published_version_id, createdAt: row.created_at, updatedAt: row.updated_at }
}
function requireOwner(ownerId: string): string { if (!ownerId?.trim()) throw new ServiceError('FORBIDDEN', 'Draft owner is required'); return ownerId }
function requireOwned(repo: SkillDraftRepository, id: string, ownerId: string): SkillDraftRecord {
  requireOwner(ownerId)
  const draft = repo.getDraft(id)
  if (!draft) throw new ServiceError('NOT_FOUND', 'Draft not found')
  if (draft.ownerId !== ownerId) throw new ServiceError('FORBIDDEN', 'Draft owner does not match')
  return draft
}
function parseContent(value: unknown): SkillDraftContent {
  const result = skillDraftContentSchema.safeParse(value)
  if (!result.success) throw new ServiceError('VALIDATION_ERROR', `Invalid draft content: ${result.error.issues[0]?.message ?? 'schema validation failed'}`)
  return result.data
}
function validateContent(content: SkillDraftContent): SkillDraftValidation {
  let files: Record<string, { content: string; sizeBytes: number; sha256: string }>
  try {
    files = buildFiles(content)
  } catch (error) {
    return {
      valid: false,
      errors: [{ level: 'error', code: error instanceof Error && 'code' in error ? String((error as any).code) : 'VALIDATION_ERROR', message: error instanceof Error ? error.message : 'Draft validation failed' }],
      warnings: [],
      securityFindings: [],
      previewSummary: { files: [], totalBytes: 0, capabilityCount: 0 },
    }
  }
  const reader: PackageReaderLike = { listFiles: () => Object.keys(files), readText: (relativePath) => ({ content: files[relativePath]?.content ?? '' }) }
  try {
    const resolution = resolveManifest(reader, { packageName: content.name })
    const unsupported = [...resolution.unsupportedCapabilities, ...findDraftSecurityFindings(content.skillMd)]
    const errors = resolution.diagnostics.filter((diagnostic) => diagnostic.level === 'error').map((diagnostic) => ({ ...diagnostic, level: 'error' as const }))
    const warnings = resolution.diagnostics.filter((diagnostic) => diagnostic.level === 'warning').map((diagnostic) => ({ ...diagnostic, level: 'warning' as const }))
    if (unsupported.length) errors.push(...unsupported.map((entry) => ({ level: 'error' as const, code: 'UNSUPPORTED_DECLARATION', message: `Unsupported declaration: ${entry}` })))
    return { valid: errors.length === 0, errors, warnings, securityFindings: unsupported, previewSummary: { files: Object.keys(files), totalBytes: Object.values(files).reduce((sum, file) => sum + file.sizeBytes, 0), capabilityCount: resolution.requiredCapabilities.length }, manifest: { ...resolution.manifest, canonicalHash: resolution.canonicalHash } }
  } catch (error) {
    return { valid: false, errors: [{ level: 'error', code: error instanceof Error && 'code' in error ? String((error as any).code) : 'MANIFEST_INVALID', message: error instanceof Error ? error.message : 'Manifest validation failed' }], warnings: [], securityFindings: [], previewSummary: { files: Object.keys(files), totalBytes: Object.values(files).reduce((sum, file) => sum + file.sizeBytes, 0), capabilityCount: 0 } }
  }
}
function findDraftSecurityFindings(skillMd: string): string[] {
  const findings: string[] = []
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(skillMd)?.[1]
  const runtime = frontmatter ? /^\s*runtime\s*:\s*[\"']?([^\"'#\s]+)[\"']?\s*(?:#.*)?$/mi.exec(frontmatter)?.[1] : undefined
  if (runtime && runtime !== 'instruction-agent') findings.push(`runtime:${runtime}`)
  for (const declaration of ['shell.execute', 'python.execute', 'dependency.install', 'workspace.write', 'home.read', 'script', 'python', 'shell', 'mcp-plugin']) {
    const escapedDeclaration = declaration.replace('.', '\\.')
    const pattern = new RegExp(String.raw`(?:^|[\s:\"])${escapedDeclaration}(?:$|[\s:\"])`, 'mi')
    if (pattern.test(skillMd)) findings.push(declaration.includes('.') ? `capability:${declaration}` : declaration)
  }
  return [...new Set(findings)]
}
function buildFiles(content: SkillDraftContent): Record<string, { content: string; sizeBytes: number; sha256: string }> {
  if (content.runtimeKind !== 'package') throw new ServiceError('VALIDATION_ERROR', 'Creator supports Package Runtime drafts only')
  for (const reservedPath of ['SKILL.md', 'manifest.json']) {
    if (Object.prototype.hasOwnProperty.call(content.references, reservedPath)) throw new ServiceError('VALIDATION_ERROR', `Creator references cannot override ${reservedPath}`)
  }
  const capabilityManifest = Object.fromEntries(content.capabilities.map((entry) => [entry.capability, entry.scope]))
  const raw: Record<string, string> = {
    'SKILL.md': content.skillMd,
    'manifest.json': JSON.stringify({ name: content.name, slug: content.slug, version: content.version, description: content.description, author: content.author, runtime: 'instruction-agent', capabilities: capabilityManifest }, null, 2),
    ...content.references,
  }
  for (const asset of content.assets) raw[asset.path] ??= ''
  const result: Record<string, { content: string; sizeBytes: number; sha256: string }> = {}
  for (const [filePath, fileContent] of Object.entries(raw)) {
    if (filePath.startsWith('/') || filePath.includes('..') || filePath.includes('\\') || filePath.includes('\0')) throw new ServiceError('VALIDATION_ERROR', `Unsafe draft path: ${filePath}`)
    const bytes = Buffer.byteLength(fileContent, 'utf8')
    result[filePath] = { content: fileContent, sizeBytes: bytes, sha256: crypto.createHash('sha256').update(fileContent).digest('hex') }
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)))
}
function materializeFiles(root: string, files: Record<string, { content: string }>): void {
  fs.mkdirSync(root, { recursive: true })
  for (const [relativePath, file] of Object.entries(files)) {
    const target = path.resolve(root, relativePath)
    if (!target.startsWith(path.resolve(root) + path.sep)) throw new ServiceError('VALIDATION_ERROR', 'Draft file escapes package root')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, file.content, 'utf8')
  }
}
function hashJson(value: unknown): string { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') }
