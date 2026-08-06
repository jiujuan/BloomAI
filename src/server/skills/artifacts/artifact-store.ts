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

export class ArtifactStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactStoreError'
  }
}

type ArtifactKind = 'markdown' | 'json' | 'prompt' | 'image-reference' | 'directory-manifest'

const artifactDefinitions: Record<ArtifactKind, { extension: string; mimeType: string }> = {
  markdown: { extension: '.md', mimeType: 'text/markdown' },
  json: { extension: '.json', mimeType: 'application/json' },
  prompt: { extension: '.txt', mimeType: 'text/plain' },
  'image-reference': { extension: '.json', mimeType: 'application/vnd.bloomai.image-reference+json' },
  'directory-manifest': { extension: '.json', mimeType: 'application/vnd.bloomai.directory-manifest+json' },
}

type ArtifactStoreDependencies = {
  readonly runs: SkillRunRepository
  readonly events: SkillRunEventRepository
  readonly artifacts: ArtifactRepository
  readonly clock: Clock
  readonly audit?: AuditRepository
}

type ArtifactStoreRecord = ArtifactSnapshot & {
  readonly run_id: string
  readonly mime_type: string | null
  readonly size_bytes: number
  readonly created_at: number
  readonly retention_until: number | null
  readonly exported_at: number | null
  readonly exported_by: string | null
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

  readContent(input: { artifactId: string; runId: string }): { mimeType: string; content: Buffer } {
    const artifact = this.dependencies.artifacts.getArtifact(input.artifactId)
    if (!artifact) throw new ArtifactStoreError(`Artifact not found: ${input.artifactId}`)
    requireArtifactOwnership(artifact, input.runId, this.dependencies.runs)
    const fullPath = resolveArtifactFile(getSkillRuntimeConfig().artifactRoot, artifact.runId, artifact.path)
    const stat = fs.lstatSync(fullPath)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new ArtifactStoreError(`Artifact file must be regular: ${input.artifactId}`)
    const content = fs.readFileSync(fullPath)
    if (hashBuffer(content) !== artifact.sha256) throw new ArtifactStoreError(`Artifact hash mismatch: ${input.artifactId}`)
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
    const sourcePath = resolveArtifactFile(config.artifactRoot, artifact.runId, artifact.path)
    const sourceStat = fs.lstatSync(sourcePath)
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) throw new ArtifactStoreError(`Artifact file must be regular: ${input.artifactId}`)
    const targetPath = path.join(destinationDir, path.basename(artifact.path))
    try {
      fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL)
    } catch (error: any) {
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
    const definition = artifactDefinitions[input.kind]
    if (path.extname(input.fileName).toLowerCase() !== definition.extension) {
      throw new ArtifactStoreError(`${input.kind} artifacts must use a ${definition.extension} file name`)
    }
    const fileName = safeFileName(input.fileName)
    const config = getSkillRuntimeConfig()
    fs.mkdirSync(config.artifactRoot, { recursive: true })
    const directory = resolveArtifactRunDirectory(config.artifactRoot, input.runId)
    fs.mkdirSync(directory, { recursive: true })
    const target = path.join(directory, fileName)
    fs.writeFileSync(target, input.content, { mode: 0o600, flag: 'wx' })
    const artifact = this.dependencies.artifacts.createArtifact({
      runId: input.runId,
      kind: input.kind,
      path: fileName,
      sha256: hashBuffer(input.content),
      mimeType: definition.mimeType,
      sizeBytes: input.content.length,
      metadata: input.metadata,
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

function safeFileName(value: string): string {
  if (!value || path.basename(value) !== value || path.isAbsolute(value) || value.includes('/') || value.includes('\\')) {
    throw new ArtifactStoreError(`Unsafe artifact file name: ${value}`)
  }
  return value
}

function hashBuffer(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function resolveArtifactFile(artifactRoot: string, runId: string, relativePath: string): string {
  const directory = resolveArtifactRunDirectory(artifactRoot, runId)
  const fileName = safeFileName(relativePath)
  const fullPath = path.resolve(directory, fileName)
  if (!fullPath.startsWith(`${directory}${path.sep}`)) throw new ArtifactStoreError(`Artifact path escapes its run directory: ${relativePath}`)
  return fullPath
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
    run_id: artifact.runId,
    mime_type: artifact.mimeType,
    size_bytes: artifact.sizeBytes,
    created_at: artifact.createdAt,
    retention_until: artifact.retentionUntil ?? null,
    exported_at: artifact.exportedAt ?? null,
    exported_by: artifact.exportedBy ?? null,
  }
}
