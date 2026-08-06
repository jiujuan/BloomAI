import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { inflateRawSync } from 'zlib'
import { runMigrations } from '../../db/client'
import { skillPackageRepo } from '../../db/repositories/skill-package.repo'
import { assertSkillRuntimeFeature, getSkillRuntimeConfig } from '../config/skill-runtime.config'
import { getSkillCorrelation, withSkillCorrelation } from '../observability/skill-runtime.logger'
import { SkillRuntimeMetrics, type SkillRuntimeCorrelation } from '../observability/skill-runtime.metrics'
import { resolveSkillManifest, type SkillManifest } from './manifest-resolver'
import { assertArchiveEntryPath, isAllowedSnapshotPath, type PackagePathPolicy } from './package-path-policy'
import { SkillPackageReader } from './package-reader'
import { detectNpxSkillsArtifact, isIgnoredArtifactPath, type NpxArtifactLayout } from './npx-artifact-detector'
import { packageInstallReviewService } from './package-install-review.service'
import { downloadGitHubArchive, GitHubSourceError, parseGitHubSource, resolveGitHubCommit } from './github-source'
import { assertPackageLimits, validateExternalSource, SkillSecurityError } from '../security/skill-security-checklist'


type LocalDirectorySource = { kind: 'local-directory'; directory: string; subdirectory?: string; metadata?: Record<string, unknown> }
type ZipSource = { kind: 'zip'; zipPath: string; subdirectory?: string; metadata?: Record<string, unknown> }
type GitHubArchiveSource = { kind: 'github-archive'; repositoryUrl: string; ref: string; subdirectory?: string }
export type PackageInstallSource = LocalDirectorySource | ZipSource | GitHubArchiveSource

export type PackageSourceSnapshot = {
  sourceSha256: string
  sourceCommit?: string
  sourceRef?: string
  sourceUrl?: string
  archiveUrl?: string
  archiveSha256?: string
  fetchedAt?: string
  etag?: string
  resolvedCommitSha?: string
  source_origin?: 'local' | 'npx-artifact'
  detected_layout?: NpxArtifactLayout
  ignored_paths?: string[]
  execution_disclaimer?: string
  files: Array<{ path: string; sha256: string; sizeBytes: number }>
}

export type InstalledPackage = {
  packageId: string
  versionId: string
  installationId: string
  status: 'awaiting_permission_review'
  sourceType: PackageInstallSource['kind']
  relativeSkillPath: string
  packagePath: string
  manifestHash: string
  sourceFingerprint: string
  diagnostics: NonNullable<SkillManifest['diagnostics']>
  importReviewRequired: boolean
  manifest: SkillManifest & { files: Array<{ path: string; sha256: string; sizeBytes: number }> }
  sourceSnapshot: PackageSourceSnapshot
}
export type InspectedPackage = {
  sourceType: PackageInstallSource['kind']
  relativeSkillPath: string
  manifestHash: string
  sourceFingerprint: string
  diagnostics: NonNullable<SkillManifest['diagnostics']>
  importReviewRequired: boolean
  manifest: SkillManifest & { files: Array<{ path: string; sha256: string; sizeBytes: number }> }
  sourceSnapshot: PackageSourceSnapshot
}


export type PackageInstallOptions = {
  reviewId: string
  sourceFingerprint: string
  confirm: boolean
}

export type PackageInstallFailure = {
  relativeSkillPath: string
  code: string
  message: string
}

export type PackageInstallResult = {
  status: 'awaiting_permission_review' | 'partial_failure'
  packages: InstalledPackage[]
  partialFailures?: PackageInstallFailure[]
}

export class PackageInstallError extends Error {
  readonly code: string

  constructor(message: string, code: string = 'PACKAGE_INSTALL_ERROR') {
    super(message)
    this.name = 'PackageInstallError'
    this.code = code
  }
}

export type PackageInstallerDependencies = {
  readonly metrics?: Pick<SkillRuntimeMetrics, 'recordImportReject'>
}

type ZipEntry = {
  name: string
  flags: number
  method: number
  compressedSize: number
  uncompressedSize: number
  externalAttributes: number
  localOffset: number
}

export class PackageInstaller {
  private readonly metrics: Pick<SkillRuntimeMetrics, 'recordImportReject'>

  constructor(dependencies: PackageInstallerDependencies = {}) {
    this.metrics = dependencies.metrics ?? SkillRuntimeMetrics.global()
  }

  async inspect(source: PackageInstallSource): Promise<{
    reviewId: string
    sourceFingerprint: string
    resolvedCommitSha?: string
    packages: InspectedPackage[]
  }> {
    const correlation = getSkillCorrelation()
    return withSkillCorrelation(correlation, async () => {
      let stage: string | undefined
      try {
        assertPackageImportEnabled()
        const securedSource = validatePackageInstallSource(source)
        const roots = getPackageRoots()
        fs.mkdirSync(roots.staging, { recursive: true })
        stage = fs.mkdtempSync(path.join(roots.staging, 'inspect-'))
      const sourceRoot = path.join(stage, 'source')
      const sourceSnapshot = await materializeSource(securedSource, sourceRoot)
      const selectedRoot = resolveSubdirectory(sourceRoot, securedSource.subdirectory)
      const skills = discoverSkillDirectories(selectedRoot)
      if (skills.length === 0) throw new PackageInstallError('No SKILL.md file was found in the selected package source')
      const packages = skills.map((skillDirectory) => {
        const files = collectFiles(skillDirectory)
        const resolvedManifest = resolveSkillManifest(skillDirectory)
        return {
          sourceType: securedSource.kind,
          relativeSkillPath: normalizeRelative(path.relative(selectedRoot, skillDirectory)),
          manifestHash: resolvedManifest.canonicalHash ?? hashJson(files),
          sourceFingerprint: hashJson(files),
          diagnostics: resolvedManifest.diagnostics ?? [],
          importReviewRequired: Boolean(resolvedManifest.requestedCapabilities.length || resolvedManifest.unsupported.length),
          manifest: { ...resolvedManifest, files },
          sourceSnapshot: { ...sourceSnapshot, files },
        }
      })
      const review = packageInstallReviewService.create({
        source: securedSource,
        sourceFingerprint: sourceSnapshot.sourceSha256,
        inspection: { sourceType: securedSource.kind, sourceFingerprint: sourceSnapshot.sourceSha256, packages },
        securityFindings: {
          unsupportedCapabilities: packages.flatMap((item) => item.manifest.unsupported),
          diagnostics: packages.flatMap((item) => item.diagnostics),
        },
      })
      return {
        reviewId: review.id,
        sourceFingerprint: sourceSnapshot.sourceSha256,
        ...(sourceSnapshot.resolvedCommitSha ? { resolvedCommitSha: sourceSnapshot.resolvedCommitSha } : {}),
        packages,
      }
      } catch (error) {
        this.recordImportReject(error, correlation)
        if (error instanceof PackageInstallError) throw error
        throw new PackageInstallError(error instanceof Error ? error.message : 'Package inspection failed')
      } finally {
        if (stage) fs.rmSync(stage, { recursive: true, force: true })
      }
    })
  }

  async install(source: PackageInstallSource, options: PackageInstallOptions): Promise<PackageInstallResult> {
    const correlation = getSkillCorrelation()
    return withSkillCorrelation(correlation, async () => {
      let stage: string | undefined
      try {
        assertPackageImportEnabled()
        const securedSource = validatePackageInstallSource(source)
        if (securedSource.kind === 'github-archive') assertPackageFeatureEnabled('githubImportEnabled')
        if (!options?.reviewId || !options.sourceFingerprint) throw new PackageInstallError('Package install requires reviewId and sourceFingerprint')

        const roots = getPackageRoots()
        fs.mkdirSync(roots.staging, { recursive: true })
        fs.mkdirSync(roots.packages, { recursive: true })
        stage = fs.mkdtempSync(path.join(roots.staging, 'install-'))
      const sourceRoot = path.join(stage, 'source')
      const sourceSnapshot = await materializeSource(securedSource, sourceRoot)
      if (sourceSnapshot.sourceSha256 !== options.sourceFingerprint) {
        throw new PackageInstallError('Package source fingerprint changed since inspection')
      }
      const review = packageInstallReviewService.assertInstallable(options.reviewId, options.sourceFingerprint, options.confirm)
      if (review.status === 'installed' && review.decision?.result) {
        return review.decision.result as unknown as PackageInstallResult
      }

      const selectedRoot = resolveSubdirectory(sourceRoot, securedSource.subdirectory)
      const skills = discoverSkillDirectories(selectedRoot)
      if (skills.length === 0) throw new PackageInstallError('No SKILL.md file was found in the selected package source')
      const packages: InstalledPackage[] = []
      const partialFailures: PackageInstallFailure[] = []
      for (const skillDirectory of skills) {
        const relativeSkillPath = normalizeRelative(path.relative(selectedRoot, skillDirectory))
        try {
          packages.push(await this.persistSkill({ skillDirectory, selectedRoot, roots, source: securedSource, sourceSnapshot }))
        } catch (error) {
          this.recordImportReject(error)
          partialFailures.push({
            relativeSkillPath,
            code: error instanceof PackageInstallError ? error.code : 'PACKAGE_INSTALL_ERROR',
            message: error instanceof Error ? error.message : 'Package installation failed',
          })
        }
      }
      const result: PackageInstallResult = partialFailures.length > 0
        ? { status: 'partial_failure', packages, partialFailures }
        : { status: 'awaiting_permission_review', packages }
      packageInstallReviewService.markInstalled(options.reviewId, result as unknown as Record<string, unknown>)
      return result
      } catch (error) {
        this.recordImportReject(error, correlation)
        if (error instanceof PackageInstallError) throw error
        throw new PackageInstallError(error instanceof Error ? error.message : 'Package installation failed')
      } finally {
        if (stage) fs.rmSync(stage, { recursive: true, force: true })
      }
    })
  }

  private async persistSkill(data: {
    skillDirectory: string
    selectedRoot: string
    roots: ReturnType<typeof getPackageRoots>
    source: PackageInstallSource
    sourceSnapshot: Omit<PackageSourceSnapshot, 'files'>
  }): Promise<InstalledPackage> {
    const files = collectFiles(data.skillDirectory)
    const resolvedManifest = resolveSkillManifest(data.skillDirectory)
    const manifestHash = resolvedManifest.canonicalHash ?? hashJson(files)
    const sourceFingerprint = hashJson(files)
    const finalPath = path.join(data.roots.packages, sourceFingerprint)
    let createdPackagePath = false
    if (!fs.existsSync(finalPath)) {
      const materializingRoot = fs.mkdtempSync(path.join(data.roots.staging, `package-${manifestHash}-`))
      const materializingPath = path.join(materializingRoot, 'package')
      try {
        copySafeDirectory(data.skillDirectory, materializingPath)
        fs.renameSync(materializingPath, finalPath)
        createdPackagePath = true
      } catch (error) {
        if (!fs.existsSync(finalPath)) throw error
      } finally {
        fs.rmSync(materializingRoot, { recursive: true, force: true })
      }
    }

    const relativeSkillPath = normalizeRelative(path.relative(data.selectedRoot, data.skillDirectory))
    const sourceSnapshot = { ...data.sourceSnapshot, files, snapshotHash: sourceFingerprint }
    const manifest = { ...resolvedManifest, files }
    const snapshotFiles = Object.fromEntries(files.map((file) => [file.path, { sha256: file.sha256, sizeBytes: file.sizeBytes }]))
    try {
      const records = skillPackageRepo.createPackageVersionInstallationTransaction({
        package: {
          name: typeof manifest.name === 'string' ? manifest.name : path.basename(data.skillDirectory),
          description: typeof manifest.description === 'string' ? manifest.description : '',
          sourceType: data.source.kind,
          sourceUri: sourceUriFor(data.source),
          sourceRef: data.sourceSnapshot.sourceCommit ?? data.sourceSnapshot.sourceRef ?? null,
        },
        version: {
          version: typeof manifest.version === 'string' ? manifest.version : `0.0.0+${manifestHash.slice(0, 12)}`,
          manifest,
          manifestHash,
          packagePath: finalPath,
          sourceSnapshot,
          securityFindings: {
            sourceFingerprint,
            unsupportedCapabilities: resolvedManifest.unsupported,
            diagnostics: resolvedManifest.diagnostics ?? [],
          },
        },
        snapshot: {
          filesManifest: snapshotFiles,
          totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
          fileCount: files.length,
          snapshotRoot: finalPath,
          snapshotHash: sourceFingerprint,
        },
        installation: { status: 'awaiting_permission_review', enabled: false },
      })
      return {
        packageId: records.package.id,
        versionId: records.version.id,
        installationId: records.installation.id,
        status: 'awaiting_permission_review',
        sourceType: data.source.kind,
        relativeSkillPath,
        packagePath: finalPath,
        manifestHash,
        manifest,
        sourceSnapshot,
        sourceFingerprint,
        diagnostics: resolvedManifest.diagnostics ?? [],
        importReviewRequired: Boolean(resolvedManifest.requestedCapabilities.length || resolvedManifest.unsupported.length),
      }
    } catch (error) {
      if (createdPackagePath) fs.rmSync(finalPath, { recursive: true, force: true })
      throw error
    }
  }

  private recordImportReject(error: unknown, correlation: SkillRuntimeCorrelation = getSkillCorrelation()): void {
    try {
      this.metrics.recordImportReject(classifyImportRejectReason(error), {
        ...correlation,
        ...getSkillCorrelation(),
      })
    } catch {
      // Import telemetry must never change package validation or installation behavior.
    }
  }
}

type ImportRejectReason =
  | 'unsupported_capability'
  | 'invalid_manifest'
  | 'security_policy'
  | 'size_limit'
  | 'file_limit'
  | 'archive_corrupt'
  | 'source_not_allowed'
  | 'unsupported_runtime'
  | 'review_required'
  | 'fingerprint_changed'
  | 'unknown'

function classifyImportRejectReason(error: unknown): ImportRejectReason {
  const candidate = error as { code?: unknown; message?: unknown }
  const code = typeof candidate.code === 'string' ? candidate.code.toUpperCase() : ''
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  const normalizedMessage = message.toLowerCase()

  if (code === 'REVIEW_FINGERPRINT_MISMATCH' || normalizedMessage.includes('fingerprint changed')) return 'fingerprint_changed'
  if (code === 'REVIEW_NOT_APPROVED' || code === 'REVIEW_REJECTED' || code === 'REVIEW_NOT_FOUND' || normalizedMessage.includes('requires explicit confirmation')) return 'review_required'
  if (code === 'SOURCE_HOST_NOT_ALLOWED' || code === 'INVALID_SOURCE_URL' || code === 'INVALID_SOURCE_REF' || normalizedMessage.includes('source host') || normalizedMessage.includes('official github')) return 'source_not_allowed'
  if (code === 'PACKAGE_FILE_BYTES_LIMIT' || code === 'PACKAGE_ARCHIVE_BYTES_LIMIT' || normalizedMessage.includes('maximum size') || normalizedMessage.includes('size limit') || normalizedMessage.includes('bytes exceed')) return 'size_limit'
  if (code === 'PACKAGE_FILE_COUNT_LIMIT' || normalizedMessage.includes('too many files') || normalizedMessage.includes('file count') || normalizedMessage.includes('file limit')) return 'file_limit'
  if (code === 'MANIFEST_INVALID' || normalizedMessage.includes('manifest') || normalizedMessage.includes('frontmatter') || normalizedMessage.includes('skill.md was not found')) return 'invalid_manifest'
  if (code === 'UNSUPPORTED_RUNTIME' || normalizedMessage.includes('unsupported runtime')) return 'unsupported_runtime'
  if (code === 'CAPABILITY_DENIED' || normalizedMessage.includes('capability is not allowed')) return 'unsupported_capability'
  if (code === 'FEATURE_DISABLED' || code === 'INVALID_PATH' || code === 'SECURITY_POLICY_VIOLATION' || normalizedMessage.includes('symbolic link') || normalizedMessage.includes('unsafe archive') || normalizedMessage.includes('path escapes') || normalizedMessage.includes('path is not allowed') || normalizedMessage.includes('non-regular') || normalizedMessage.includes('security policy') || normalizedMessage.includes('traversal')) return 'security_policy'
  if (normalizedMessage.includes('zip') || normalizedMessage.includes('archive') || normalizedMessage.includes('central directory') || normalizedMessage.includes('local file header')) return 'archive_corrupt'
  return 'unknown'
}

function validatePackageInstallSource(source: PackageInstallSource): PackageInstallSource {
  try {
    return validateExternalSource(source) as PackageInstallSource
  } catch (error) {
    if (error instanceof SkillSecurityError) throw new PackageInstallError(error.message, error.code)
    throw error
  }
}

function assertPackageImportEnabled(): void {
  try { assertSkillRuntimeFeature('importEnabled') } catch (error) { throw new PackageInstallError(error instanceof Error ? error.message : 'Skill Package import is disabled', 'FEATURE_DISABLED') }
}

function assertPackageFeatureEnabled(feature: 'githubImportEnabled' | 'npxImportEnabled'): void {
  try { assertSkillRuntimeFeature(feature) } catch (error) { throw new PackageInstallError(error instanceof Error ? error.message : `Skill Runtime feature is disabled: ${feature}`, 'FEATURE_DISABLED') }
}

function getPackageRoots() {
  const root = getSkillRuntimeConfig().packageDataRoot
  return { root: path.dirname(root), packages: root, staging: path.join(path.dirname(root), 'staging') }
}

function getPackageLimits() {
  const config = getSkillRuntimeConfig()
  return {
    maxArchiveBytes: config.maxPackageBytes,
    maxFileCount: config.maxPackageFiles,
    maxFileBytes: config.maxFileBytes,
    maxUnpackedBytes: config.maxPackageBytes,
    maxPathLength: 240,
    maxDepth: 32,
  } satisfies PackagePathPolicy
}

async function materializeSource(source: PackageInstallSource, target: string): Promise<Omit<PackageSourceSnapshot, 'files'>> {
  const securedSource = validatePackageInstallSource(source)
  if (securedSource.kind === 'local-directory') {
    const directory = securedSource.directory
    if (!fs.statSync(directory).isDirectory()) throw new PackageInstallError(`Local package directory not found: ${directory}`)
    copySafeDirectory(directory, target)
    const artifactMetadata = detectAndSanitizeNpxArtifact(target)
    return { sourceSha256: hashDirectory(target), sourceRef: directory, ...artifactMetadata }
  }
  if (securedSource.kind === 'zip') {
    const zipPath = securedSource.zipPath
    if (!fs.statSync(zipPath).isFile()) throw new PackageInstallError(`ZIP package not found: ${zipPath}`)
    const archive = fs.readFileSync(zipPath)
    extractZip(archive, target)
    const artifactMetadata = detectAndSanitizeNpxArtifact(target)
    return { sourceSha256: hashBuffer(archive), sourceRef: zipPath, ...artifactMetadata }
  }
  let parsedSource
  try {
    parsedSource = parseGitHubSource(securedSource.repositoryUrl, securedSource.ref, securedSource.subdirectory)
    const config = getSkillRuntimeConfig()
    const { commitSha } = await resolveGitHubCommit(parsedSource, {
      timeoutMs: config.githubRequestTimeoutMs,
      allowedHosts: config.githubAllowedHosts,
    })
    const downloaded = await downloadGitHubArchive(parsedSource, commitSha, {
      timeoutMs: config.githubRequestTimeoutMs,
      maxArchiveBytes: config.githubMaxArchiveBytes,
      allowedHosts: config.githubAllowedHosts,
    })
    extractZip(downloaded.archive, target)
    return {
      sourceSha256: downloaded.archiveSha256,
      sourceCommit: downloaded.resolvedCommitSha,
      sourceRef: downloaded.sourceRef,
      sourceUrl: downloaded.sourceUrl,
      archiveUrl: downloaded.archiveUrl,
      archiveSha256: downloaded.archiveSha256,
      fetchedAt: downloaded.fetchedAt,
      ...(downloaded.etag ? { etag: downloaded.etag } : {}),
      resolvedCommitSha: downloaded.resolvedCommitSha,
    }
  } catch (error) {
    if (error instanceof GitHubSourceError) throw new PackageInstallError(error.message, error.code)
    throw error
  }
}

function detectAndSanitizeNpxArtifact(root: string): Pick<PackageSourceSnapshot, 'source_origin' | 'detected_layout' | 'ignored_paths' | 'execution_disclaimer'> {
  const limits = getPackageLimits()
  const reader = new SkillPackageReader(root, {
    ...limits,
    maxReadBytes: limits.maxFileBytes,
    maxFilesPerRun: limits.maxFileCount,
  })
  const detection = detectNpxSkillsArtifact(reader)
  if (!detection.isNpxArtifact) return {}
  assertPackageFeatureEnabled('npxImportEnabled')
  pruneIgnoredArtifactPaths(root, detection.ignoredPaths)
  return {
    source_origin: 'npx-artifact',
    detected_layout: detection.layout,
    ignored_paths: detection.ignoredPaths,
    execution_disclaimer: detection.executionDisclaimer,
  }
}

function pruneIgnoredArtifactPaths(root: string, ignoredPaths: string[]): void {
  const pathsToRemove = new Set<string>()
  for (const relativePath of ignoredPaths) {
    pathsToRemove.add(relativePath)
    const segments = relativePath.split('/').filter(Boolean)
    for (let index = 0; index < segments.length; index += 1) {
      if (isIgnoredArtifactPath(segments[index]) || isIgnoredArtifactPath(segments.slice(0, index + 1).join('/'))) {
        pathsToRemove.add(segments.slice(0, index + 1).join('/'))
        break
      }
    }
  }
  for (const relativePath of [...pathsToRemove].sort((a, b) => b.length - a.length)) {
    const target = safeDestination(root, relativePath)
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
  }
}

function extractZip(archive: Buffer, target: string): void {
  if (archive.length > getPackageLimits().maxArchiveBytes) throw new PackageInstallError('Archive exceeds the maximum allowed size')
  const limits = getPackageLimits()
  const entries = parseZipEntries(archive)
  if (entries.length > limits.maxFileCount) throw new PackageInstallError('Archive contains too many files')
  let totalBytes = 0
  const seen = new Set<string>()
  for (const entry of entries) {
    const isDirectory = entry.name.endsWith('/')
    const name = normalizeArchivePath(entry.name)
    if (seen.has(name)) throw new PackageInstallError(`Archive contains duplicate file path: ${name}`)
    seen.add(name)
    try { assertPackageLimits({ fileCount: seen.size, totalBytes: totalBytes + entry.uncompressedSize, fileBytes: entry.uncompressedSize, ...limits }) }
    catch (error) { throw new PackageInstallError(error instanceof Error ? error.message : `Archive entry exceeds package limits: ${name}`, error instanceof SkillSecurityError ? error.code : 'PACKAGE_INSTALL_ERROR') }
    totalBytes += entry.uncompressedSize
    const unixType = (entry.externalAttributes >>> 16) & 0o170000
    if (unixType === 0o120000 || unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000) throw new PackageInstallError(`Archive contains a non-regular file: ${name}`)
    if (isDirectory) continue
    const destination = safeDestination(target, name)
    if (isSensitivePath(name)) continue
    const data = readZipEntry(archive, entry)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, data, { mode: 0o600 })
  }
}

function parseZipEntries(archive: Buffer): ZipEntry[] {
  const minOffset = Math.max(0, archive.length - 65_557)
  let endOffset = -1
  for (let offset = archive.length - 22; offset >= minOffset; offset--) if (archive.readUInt32LE(offset) === 0x06054b50) { endOffset = offset; break }
  if (endOffset < 0) throw new PackageInstallError('ZIP end-of-central-directory record is missing')
  const entryCount = archive.readUInt16LE(endOffset + 10)
  const centralSize = archive.readUInt32LE(endOffset + 12)
  const centralOffset = archive.readUInt32LE(endOffset + 16)
  if (centralOffset + centralSize > archive.length) throw new PackageInstallError('ZIP central directory is out of bounds')
  const entries: ZipEntry[] = []
  let cursor = centralOffset
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== 0x02014b50) throw new PackageInstallError('ZIP central directory entry is invalid')
    const flags = archive.readUInt16LE(cursor + 8)
    const method = archive.readUInt16LE(cursor + 10)
    const compressedSize = archive.readUInt32LE(cursor + 20)
    const uncompressedSize = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const externalAttributes = archive.readUInt32LE(cursor + 38)
    const localOffset = archive.readUInt32LE(cursor + 42)
    const end = cursor + 46 + nameLength + extraLength + commentLength
    if (end > archive.length) throw new PackageInstallError('ZIP entry name is out of bounds')
    if ((flags & 0x1) !== 0) throw new PackageInstallError('Encrypted ZIP entries are not supported')
    if (method !== 0 && method !== 8) throw new PackageInstallError(`Unsupported ZIP compression method: ${method}`)
    entries.push({ name: archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'), flags, method, compressedSize, uncompressedSize, externalAttributes, localOffset })
    cursor = end
  }
  return entries
}

function readZipEntry(archive: Buffer, entry: ZipEntry): Buffer {
  if (entry.localOffset + 30 > archive.length || archive.readUInt32LE(entry.localOffset) !== 0x04034b50) throw new PackageInstallError(`ZIP local file header is invalid: ${entry.name}`)
  const flags = archive.readUInt16LE(entry.localOffset + 6)
  const method = archive.readUInt16LE(entry.localOffset + 8)
  if (flags !== entry.flags || method !== entry.method) throw new PackageInstallError(`ZIP header metadata does not match: ${entry.name}`)
  const nameLength = archive.readUInt16LE(entry.localOffset + 26)
  const extraLength = archive.readUInt16LE(entry.localOffset + 28)
  const dataStart = entry.localOffset + 30 + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > archive.length) throw new PackageInstallError(`ZIP file contents are out of bounds: ${entry.name}`)
  const compressed = archive.subarray(dataStart, dataEnd)
  const data = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed)
  if (data.length !== entry.uncompressedSize) throw new PackageInstallError(`ZIP entry size does not match: ${entry.name}`)
  return data
}

function copySafeDirectory(source: string, target: string): void {
  copySafeDirectoryWithBudget(source, target, { fileCount: 0, totalBytes: 0 })
}

function copySafeDirectoryWithBudget(source: string, target: string, budget: { fileCount: number; totalBytes: number }): void {
  const stat = fs.lstatSync(source)
  if (stat.isSymbolicLink()) throw new PackageInstallError(`Symbolic links are not allowed: ${source}`)
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name)
    const targetPath = path.join(target, entry.name)
    const entryStat = fs.lstatSync(sourcePath)
    if (entryStat.isSymbolicLink()) throw new PackageInstallError(`Symbolic links are not allowed: ${sourcePath}`)
    if (entry.isDirectory()) { if (!isSensitivePath(entry.name)) copySafeDirectoryWithBudget(sourcePath, targetPath, budget); continue }
    if (!entry.isFile()) throw new PackageInstallError(`Non-regular package file is not allowed: ${sourcePath}`)
    if (entryStat.nlink > 1) throw new PackageInstallError(`Hard-linked package files are not allowed: ${sourcePath}`)
    if (entryStat.size > getPackageLimits().maxFileBytes) throw new PackageInstallError(`Package file exceeds the maximum size: ${sourcePath}`)
    if (isSensitivePath(entry.name)) continue
    budget.fileCount += 1
    budget.totalBytes += entryStat.size
    const limits = getPackageLimits()
    try { assertPackageLimits({ fileCount: budget.fileCount, totalBytes: budget.totalBytes, fileBytes: entryStat.size, ...limits }) }
    catch (error) { throw new PackageInstallError(error instanceof Error ? error.message : 'Package source exceeds the configured limits', error instanceof SkillSecurityError ? error.code : 'PACKAGE_INSTALL_ERROR') }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.copyFileSync(sourcePath, targetPath)
  }
}

function discoverSkillDirectories(root: string): string[] {
  const skills: string[] = []
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      const stat = fs.lstatSync(fullPath)
      if (stat.isSymbolicLink()) throw new PackageInstallError(`Symbolic links are not allowed: ${fullPath}`)
      if (entry.isDirectory()) { if (!isSensitivePath(entry.name)) visit(fullPath) }
      else if (entry.isFile() && entry.name === 'SKILL.md') skills.push(directory)
    }
  }
  visit(root)
  return skills.sort((a, b) => normalizeRelative(path.relative(root, a)).localeCompare(normalizeRelative(path.relative(root, b))))
}

function collectFiles(root: string) {
  const limits = getPackageLimits()
  const reader = new SkillPackageReader(root, {
    ...limits,
    maxReadBytes: limits.maxFileBytes,
    maxFilesPerRun: limits.maxFileCount,
  })
  return reader.listFiles()
    .filter((file) => isAllowedSnapshotPath(file))
    .map((file) => reader.readBuffer(file, limits.maxFileBytes))
    .map(({ path: filePath, sha256, sizeBytes }) => ({ path: filePath, sha256, sizeBytes }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

function resolveSubdirectory(root: string, subdirectory?: string): string {
  if (!subdirectory) return root
  const relative = normalizeArchivePath(subdirectory)
  const direct = safeDestination(root, relative)
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) return direct
  const rootEntries = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  if (rootEntries.length === 1) {
    const archivePrefixed = safeDestination(root, `${rootEntries[0].name}/${relative}`)
    if (fs.existsSync(archivePrefixed) && fs.statSync(archivePrefixed).isDirectory()) return archivePrefixed
  }
  throw new PackageInstallError(`Package subdirectory not found: ${subdirectory}`)
}

function normalizeArchivePath(value: string): string {
  const withoutTrailingSlash = value.endsWith('/') ? value.slice(0, -1) : value
  try { return assertArchiveEntryPath(withoutTrailingSlash, getPackageLimits()) }
  catch (error) { throw new PackageInstallError(error instanceof Error ? error.message : `Unsafe archive path: ${value}`) }
}

function safeDestination(root: string, relative: string): string {
  const destination = path.resolve(root, ...relative.split('/'))
  const resolvedRoot = path.resolve(root)
  if (!destination.startsWith(`${resolvedRoot}${path.sep}`)) throw new PackageInstallError(`Package path escapes the destination root: ${relative}`)
  return destination
}

function normalizeRelative(relative: string): string { return relative ? relative.split(path.sep).join('/') : '.' }
function isSensitivePath(value: string): boolean {
  const lower = path.basename(value).toLowerCase()
  return lower === '.env' || lower.startsWith('.env.') || /(^|[_-])(secret|credential|api[_-]?key|token)([_-]|$)/.test(lower) || /\.(pem|key|p12|pfx)$/i.test(lower)
}
function sourceUriFor(source: PackageInstallSource): string { return source.kind === 'local-directory' ? path.resolve(source.directory) : source.kind === 'zip' ? path.resolve(source.zipPath) : source.repositoryUrl }
function hashDirectory(directory: string): string { return hashJson(collectFiles(directory)) }
function hashJson(value: unknown): string { return hashBuffer(Buffer.from(JSON.stringify(value))) }
function hashBuffer(value: Buffer): string { return crypto.createHash('sha256').update(value).digest('hex') }
