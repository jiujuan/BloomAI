import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getSkillRunArtifactsDir } from '../../db/paths'
import { skillPackageRepo } from '../../db/repositories/skill-package.repo'

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

export class ArtifactStore {
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
    const artifact = skillPackageRepo.getArtifact(input.artifactId)
    if (!artifact) throw new ArtifactStoreError(`Artifact not found: ${input.artifactId}`)
    requireArtifactOwnership(artifact, input.runId)
    const fullPath = resolveArtifactFile(artifact.run_id, artifact.path)
    const stat = fs.lstatSync(fullPath)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new ArtifactStoreError(`Artifact file must be regular: ${input.artifactId}`)
    const content = fs.readFileSync(fullPath)
    if (hashBuffer(content) !== artifact.sha256) throw new ArtifactStoreError(`Artifact hash mismatch: ${input.artifactId}`)
    return { mimeType: artifact.mime_type ?? 'application/octet-stream', content }
  }

  exportArtifact(input: { artifactId: string; runId: string; destinationDir: string }): string {
    const destinationDir = existingDirectory(input.destinationDir)
    const artifact = skillPackageRepo.getArtifact(input.artifactId)
    if (!artifact) throw new ArtifactStoreError(`Artifact not found: ${input.artifactId}`)
    requireArtifactOwnership(artifact, input.runId)
    const sourcePath = resolveArtifactFile(artifact.run_id, artifact.path)
    const sourceStat = fs.lstatSync(sourcePath)
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) throw new ArtifactStoreError(`Artifact file must be regular: ${input.artifactId}`)
    const targetPath = path.join(destinationDir, path.basename(artifact.path))
    try {
      fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL)
    } catch (error: any) {
      if (error?.code === 'EEXIST') throw new ArtifactStoreError(`Export destination already contains: ${path.basename(artifact.path)}`)
      throw new ArtifactStoreError(`Artifact export failed: ${input.artifactId}`)
    }
    return targetPath
  }

  removeRun(_runId: string): void {
    // Retention policy: artifact files and metadata remain available for audit and export.
  }

  private writeBuffer(input: { runId: string; kind: ArtifactKind; fileName: string; content: Buffer; metadata?: Record<string, unknown> }) {
    requireExistingRunId(input.runId)
    const definition = artifactDefinitions[input.kind]
    if (path.extname(input.fileName).toLowerCase() !== definition.extension) {
      throw new ArtifactStoreError(`${input.kind} artifacts must use a ${definition.extension} file name`)
    }
    const fileName = safeFileName(input.fileName)
    const directory = getSkillRunArtifactsDir(input.runId)
    fs.mkdirSync(directory, { recursive: true })
    const target = path.join(directory, fileName)
    fs.writeFileSync(target, input.content, { mode: 0o600, flag: 'wx' })
    return skillPackageRepo.createArtifact({
      runId: input.runId,
      kind: input.kind,
      path: fileName,
      sha256: hashBuffer(input.content),
      mimeType: definition.mimeType,
      sizeBytes: input.content.length,
      metadata: input.metadata,
    })
  }
}

function requireArtifactOwnership(artifact: { id: string; run_id: string }, runId: string): void {
  requireExistingRunId(runId)
  if (artifact.run_id !== runId) throw new ArtifactStoreError(`Artifact not found for run: ${artifact.id}`)
}

function requireExistingRunId(runId: string): void {
  if (!runId || path.basename(runId) !== runId || path.isAbsolute(runId) || runId.includes('/') || runId.includes('\\')) {
    throw new ArtifactStoreError(`Unsafe skill run id: ${runId}`)
  }
  if (!skillPackageRepo.getRun(runId)) throw new ArtifactStoreError(`Skill run not found: ${runId}`)
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

function resolveArtifactFile(runId: string, relativePath: string): string {
  const directory = path.resolve(getSkillRunArtifactsDir(runId))
  const fileName = safeFileName(relativePath)
  const fullPath = path.resolve(directory, fileName)
  if (!fullPath.startsWith(`${directory}${path.sep}`)) throw new ArtifactStoreError(`Artifact path escapes its run directory: ${relativePath}`)
  return fullPath
}

function existingDirectory(value: string): string {
  if (!value || !path.isAbsolute(value)) throw new ArtifactStoreError(`Export destination must be an absolute directory: ${value}`)
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(value)
  } catch {
    throw new ArtifactStoreError(`Export destination does not exist: ${value}`)
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ArtifactStoreError(`Export destination must be a regular directory: ${value}`)
  return fs.realpathSync.native(value)
}
