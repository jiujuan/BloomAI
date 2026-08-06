import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getSkillRuntimeConfig } from '../config/skill-runtime.config'
import {
  createSqliteArtifactRepository,
  createSqliteAuditRepository,
  createSqliteEventRepository,
  createSqliteRunRepository,
} from '../../db/repositories/skill-package.repo'
import type { ArtifactRepository, ArtifactSnapshot, AuditRepository, Clock, SkillRunEventRepository, SkillRunRepository } from '../application/ports'
import { normalizeSkillRunEvent } from '../runtime/skill-run-events'
import { cleanupRunArtifacts as cleanupRunDirectory, resolveArtifactRunDirectory, resolveExportDestination, SkillPathPolicyError } from '../filesystem/skill-path-policy'
import {
  artifactDefinitions,
  summarizeArtifactContent,
  validateArtifactInput,
  validateArtifactFileName,
  type ArtifactKind,
} from './artifact-policy'
import { ArtifactPolicyError } from './artifact-policy'

export class ArtifactStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactStoreError'
  }
}

export type ArtifactListOptions = {
  readonly limit?: number
  readonly offset?: number
  readonly sort?: 'createdAt' | 'size' | 'kind'
  readonly direction?: 'asc' | 'desc'
}

export type ArtifactStoreRecord = ArtifactSnapshot & {
  readonly artifact_kind: string
  readonly relative_path: string
  readonly run_id: string
  readonly mime_type: string | null
  readonly size_bytes: number
  readonly created_at: number
  readonly retention_until: number | null
  readonly exported_at: number | null
  readonly exported_by: string | null
}

export type ArtifactListItem = ArtifactStoreRecord & {
  readonly summary: {
    readonly contentPreview: string | null
  }
}

export type ArtifactListPage = {
  readonly data: readonly ArtifactListItem[]
  readonly total: number
  readonly limit: number
  readonly offset: number
  readonly nextOffset: number | null
}

type ArtifactStoreDependencies = {
  readonly runs: SkillRunRepository
  readonly events: SkillRunEventRepository
  readonly artifacts: ArtifactRepository
  readonly clock: Clock
  readonly audit?: AuditRepository
}

export class ArtifactStore {
  private readonly dependencies: ArtifactStoreDependencies

  constructor(dependencies: ArtifactStoreDependencies = createDefaultArtifactStoreDependencies()) {
    this.dependencies = dependencies
  }

  writeText(input: { runId: string; kind: Exclude<ArtifactKind, 'image-reference'>; fileName: string; content: string; metadata?: Record<string, unknown> }) {
    return this.writeBuffer({ ...input, content: Buffer.from(input.content, 'utf8') })
  }

  writeImageReference(input: { runId: string; fileName: string; reference: Record<string, unknown>; metadata?: Record<string, unknown> }) {
    return this.writeBuffer({
      runId: input.runId,
      kind: 'image-reference',
      fileName: input.fileName,
      content: Buffer.from(JSON.stringify(input.reference), 'utf8'),
      metadata: input.metadata,
    })
  }

  listArtifacts(input: { runId: string } & ArtifactListOptions): ArtifactListPage {
    requireExistingRunId(input.runId, this.dependencies.runs)
    const limit = normalizePageLimit(input.limit)
    const offset = normalizePageOffset(input.offset)
    const sort = input.sort ?? 'createdAt'
    const direction = input.direction ?? 'asc'
    const artifacts = [...this.dependencies.artifacts.listArtifacts(input.runId)]
      .sort((left, right) => compareArtifacts(left, right, sort, direction))
    const data = artifacts.slice(offset, offset + limit).map((artifact) => {
      const record = toArtifactStoreRecord(artifact)
      const content = readArtifactBytes(getSkillRuntimeConfig().artifactRoot, artifact)
      return {
        ...record,
        summary: { contentPreview: summarizeArtifactContent(content, artifact.mimeType ?? 'application/octet-stream') },
      }
    })
    const nextOffset = offset + data.length < artifacts.length ? offset + data.length : null
    return { data, total: artifacts.length, limit, offset, nextOffset }
  }

  readContent(input: { artifactId: string; runId: string }): { mimeType: string; content: Buffer } {
    const artifact = this.dependencies.artifacts.getArtifact(input.artifactId)
    if (!artifact) throw new ArtifactStoreError(`Artifact not found: ${input.artifactId}`)
    requireArtifactOwnership(artifact, input.runId, this.dependencies.runs)
    const content = readArtifactBytes(getSkillRuntimeConfig().artifactRoot, artifact)
    return { mimeType: artifact.mimeType ?? 'application/octet-stream', content }
  }

  exportArtifact(input: {
    artifactId: string
    runId: string
    destinationDir?: string
    confirmed?: boolean
    actor?: string | null
    auditReason?: string
  }): string {
    if (input.confirmed !== true) throw new ArtifactStoreError('Artifact export requires explicit confirmation')
    if (!input.auditReason?.trim()) throw new ArtifactStoreError('Artifact export requires an audit reason')
    const config = getSkillRuntimeConfig()
    let destinationDir: string
    try {
      destinationDir = resolveExportDestination(config.exportRoot, input.destinationDir)
    } catch (error) {
      if (error instanceof SkillPathPolicyError) throw new ArtifactStoreError(error.message)
      throw error
    }
    const artifact = this.dependencies.artifacts.getArtifact(input.artifactId)
    if (!artifact) throw new ArtifactStoreError(`Artifact not found: ${input.artifactId}`)
    requireArtifactOwnership(artifact, input.runId, this.dependencies.runs)
    const content = readArtifactBytes(config.artifactRoot, artifact)
    const targetPath = path.join(destinationDir, path.basename(artifact.path))
    if (fs.existsSync(targetPath)) throw new ArtifactStoreError(`Export destination already contains: ${path.basename(artifact.path)}`)

    const temporaryPath = path.join(destinationDir, `.${path.basename(artifact.path)}.${crypto.randomUUID()}.tmp`)
    try {
      fs.writeFileSync(temporaryPath, content, { mode: 0o600, flag: 'wx' })
      if (fs.existsSync(targetPath)) throw new ArtifactStoreError(`Export destination already contains: ${path.basename(artifact.path)}`)
      fs.renameSync(temporaryPath, targetPath)
    } catch (error: any) {
      try { if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true }) } catch { /* best effort cleanup */ }
      if (error instanceof ArtifactStoreError) throw error
      if (error?.code === 'EEXIST') throw new ArtifactStoreError(`Export destination already contains: ${path.basename(artifact.path)}`)
      throw new ArtifactStoreError(`Artifact export failed: ${input.artifactId}`)
    }

    const exportedAt = this.dependencies.clock.now()
    this.dependencies.artifacts.markArtifactExported?.({ id: artifact.id, exportedAt, exportedBy: input.actor ?? null })
    this.dependencies.audit?.append({
      actor: input.actor ?? null,
      action: 'artifact.exported',
      resourceType: 'skill_artifact',
      resourceId: artifact.id,
      payload: { runId: input.runId, destinationDir, auditReason: input.auditReason.trim() },
    })
    return targetPath
  }

  removeRun(runId: string): boolean {
    const artifacts = this.dependencies.artifacts.listArtifacts(runId)
    if (!artifacts.length || artifacts.some((artifact) => artifact.retentionUntil === null || artifact.retentionUntil === undefined || artifact.retentionUntil > this.dependencies.clock.now())) return false
    return cleanupRunDirectory(getSkillRuntimeConfig().artifactRoot, runId)
  }

  private writeBuffer(input: { runId: string; kind: ArtifactKind; fileName: string; content: Buffer; metadata?: Record<string, unknown> }) {
    requireExistingRunId(input.runId, this.dependencies.runs)
    const config = getSkillRuntimeConfig()
    let validated: ReturnType<typeof validateArtifactInput>
    try {
      validated = validateArtifactInput({
        ...input,
        maxContentBytes: config.maxFileBytes,
      })
    } catch (error) {
      if (error instanceof ArtifactPolicyError) throw new ArtifactStoreError(error.message)
      throw error
    }
    fs.mkdirSync(config.artifactRoot, { recursive: true })
    const directory = resolveArtifactRunDirectory(config.artifactRoot, input.runId)
    fs.mkdirSync(directory, { recursive: true })
    const target = path.join(directory, validated.fileName)
    fs.writeFileSync(target, input.content, { mode: 0o600, flag: 'wx' })
    const artifact = this.dependencies.artifacts.createArtifact({
      runId: input.runId,
      kind: input.kind,
      path: validated.fileName,
      sha256: hashBuffer(input.content),
      mimeType: validated.mimeType,
      sizeBytes: input.content.length,
      metadata: validated.metadata,
      retentionUntil: this.dependencies.clock.now() + config.artifactRetentionDays * 24 * 60 * 60 * 1000,
    })
    this.dependencies.events.appendEvent({
      runId: input.runId,
      seq: this.dependencies.events.nextSequence(input.runId),
      ...normalizeSkillRunEvent({
        type: 'artifact.created',
        payload: {
          artifactId: artifact.id,
          kind: artifact.kind,
          path: artifact.path,
          sha256: artifact.sha256,
          sizeBytes: artifact.sizeBytes,
        },
      }),
    })
    return toArtifactStoreRecord(artifact)
  }
}

function requireArtifactOwnership(artifact: Pick<ArtifactSnapshot, 'id' | 'runId'>, runId: string, runs: SkillRunRepository): void {
  requireExistingRunId(runId, runs)
  if (artifact.runId !== runId) throw new ArtifactStoreError(`Artifact not found for run: ${artifact.id}`)
}

function requireExistingRunId(runId: string, runs: SkillRunRepository): void {
  if (!runId || path.basename(runId) !== runId || path.isAbsolute(runId) || runId.includes('/') || runId.includes('\\')) {
    throw new ArtifactStoreError(`Unsafe skill run id: ${runId}`)
  }
  if (!runs.getRun(runId)) throw new ArtifactStoreError(`Skill run not found: ${runId}`)
}

function hashBuffer(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function resolveArtifactFile(artifactRoot: string, runId: string, relativePath: string): string {
  const directory = resolveArtifactRunDirectory(artifactRoot, runId)
  let fileName: string
  try {
    fileName = validateArtifactFileName(relativePath)
  } catch (error) {
    throw new ArtifactStoreError(error instanceof Error ? error.message : String(error))
  }
  const fullPath = path.resolve(directory, fileName)
  if (!fullPath.startsWith(`${directory}${path.sep}`)) throw new ArtifactStoreError(`Artifact path escapes its run directory: ${relativePath}`)
  return fullPath
}
function readArtifactBytes(artifactRoot: string, artifact: ArtifactSnapshot): Buffer {
  const fullPath = resolveArtifactFile(artifactRoot, artifact.runId, artifact.path)
  const stat = fs.lstatSync(fullPath)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new ArtifactStoreError(`Artifact file must be regular: ${artifact.id}`)
  const content = fs.readFileSync(fullPath)
  if (content.length !== artifact.sizeBytes) throw new ArtifactStoreError(`Artifact size mismatch: ${artifact.id}`)
  if (hashBuffer(content) !== artifact.sha256) throw new ArtifactStoreError(`Artifact hash mismatch: ${artifact.id}`)
  const definition = artifactDefinitions[artifact.kind as ArtifactKind]
  if (definition && artifact.mimeType && artifact.mimeType !== definition.mimeType) throw new ArtifactStoreError(`Artifact MIME mismatch: ${artifact.id}`)
  return content
}

function normalizePageLimit(value: number | undefined): number {
  if (value === undefined) return 50
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new ArtifactStoreError('Artifact page limit must be between 1 and 100')
  return value
}

function normalizePageOffset(value: number | undefined): number {
  if (value === undefined) return 0
  if (!Number.isInteger(value) || value < 0) throw new ArtifactStoreError('Artifact page offset must be a non-negative integer')
  return value
}

function compareArtifacts(left: ArtifactSnapshot, right: ArtifactSnapshot, sort: 'createdAt' | 'size' | 'kind', direction: 'asc' | 'desc'): number {
  const leftValue = sort === 'size' ? left.sizeBytes : sort === 'kind' ? left.kind : left.createdAt
  const rightValue = sort === 'size' ? right.sizeBytes : sort === 'kind' ? right.kind : right.createdAt
  const base = typeof leftValue === 'string' && typeof rightValue === 'string'
    ? leftValue.localeCompare(rightValue)
    : Number(leftValue) - Number(rightValue)
  const result = base !== 0 ? base : left.id.localeCompare(right.id)
  return direction === 'desc' ? -result : result
}

function createDefaultArtifactStoreDependencies(): ArtifactStoreDependencies {
  const clock: Clock = { now: () => Date.now() }
  return {
    runs: createSqliteRunRepository(),
    events: createSqliteEventRepository(clock),
    artifacts: createSqliteArtifactRepository(),
    clock,
    audit: createSqliteAuditRepository(),
  }
}

function toArtifactStoreRecord(artifact: ArtifactSnapshot): ArtifactStoreRecord {
  return {
    ...artifact,
    artifact_kind: artifact.kind,
    relative_path: artifact.path,
    run_id: artifact.runId,
    mime_type: artifact.mimeType,
    size_bytes: artifact.sizeBytes,
    created_at: artifact.createdAt,
    retention_until: artifact.retentionUntil ?? null,
    exported_at: artifact.exportedAt ?? null,
    exported_by: artifact.exportedBy ?? null,
  }
}
