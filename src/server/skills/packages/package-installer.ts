import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { inflateRawSync } from 'zlib'
import { getDataDir } from '../../db/paths'
import { isSkillPackageRuntimeEnabled } from './feature-flag'

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
const MAX_FILE_COUNT = 10_000
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_UNPACKED_BYTES = 100 * 1024 * 1024

type LocalDirectorySource = { kind: 'local-directory'; directory: string; subdirectory?: string }
type ZipSource = { kind: 'zip'; zipPath: string; subdirectory?: string }
type GitHubArchiveSource = { kind: 'github-archive'; repositoryUrl: string; ref: string; subdirectory?: string }
export type PackageInstallSource = LocalDirectorySource | ZipSource | GitHubArchiveSource

export type InstalledPackage = {
  packageId: string
  versionId: string
  installationId: string
  status: 'awaiting_permission_review'
  sourceType: PackageInstallSource['kind']
  relativeSkillPath: string
  packagePath: string
  manifestHash: string
  manifest: { entryPath: 'SKILL.md'; files: Array<{ path: string; sha256: string; sizeBytes: number }> }
  sourceSnapshot: { sourceSha256: string; sourceCommit?: string; sourceRef?: string; files: Array<{ path: string; sha256: string; sizeBytes: number }> }
}

export type PackageInstallResult = { status: 'awaiting_permission_review'; packages: InstalledPackage[] }

export class PackageInstallError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackageInstallError'
  }
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
  async install(source: PackageInstallSource): Promise<PackageInstallResult> {
    if (!isSkillPackageRuntimeEnabled()) throw new PackageInstallError('Skill Package Runtime is disabled')

    const roots = getPackageRoots()
    fs.mkdirSync(roots.staging, { recursive: true })
    fs.mkdirSync(roots.packages, { recursive: true })
    const stage = fs.mkdtempSync(path.join(roots.staging, 'install-'))
    try {
      const sourceRoot = path.join(stage, 'source')
      const sourceSnapshot = await materializeSource(source, sourceRoot)
      const selectedRoot = resolveSubdirectory(sourceRoot, source.subdirectory)
      const skills = discoverSkillDirectories(selectedRoot)
      if (skills.length === 0) throw new PackageInstallError('No SKILL.md file was found in the selected package source')
      const packages: InstalledPackage[] = []
      for (const skillDirectory of skills) {
        packages.push(await this.persistSkill({ skillDirectory, selectedRoot, roots, source, sourceSnapshot }))
      }
      return { status: 'awaiting_permission_review', packages }
    } catch (error) {
      if (error instanceof PackageInstallError) throw error
      throw new PackageInstallError(error instanceof Error ? error.message : 'Package installation failed')
    } finally {
      fs.rmSync(stage, { recursive: true, force: true })
    }
  }

  private async persistSkill(data: {
    skillDirectory: string
    selectedRoot: string
    roots: ReturnType<typeof getPackageRoots>
    source: PackageInstallSource
    sourceSnapshot: { sourceSha256: string; sourceCommit?: string; sourceRef?: string }
  }): Promise<InstalledPackage> {
    const files = collectFiles(data.skillDirectory)
    const manifestHash = hashJson(files)
    const finalPath = path.join(data.roots.packages, manifestHash)
    if (!fs.existsSync(finalPath)) {
      const materializingRoot = fs.mkdtempSync(path.join(data.roots.staging, `package-${manifestHash}-`))
      const materializingPath = path.join(materializingRoot, 'package')
      try {
        copySafeDirectory(data.skillDirectory, materializingPath)
        fs.renameSync(materializingPath, finalPath)
      } catch (error) {
        if (!fs.existsSync(finalPath)) throw error
      } finally {
        fs.rmSync(materializingRoot, { recursive: true, force: true })
      }
    }
    const relativeSkillPath = normalizeRelative(path.relative(data.selectedRoot, data.skillDirectory))
    const sourceSnapshot = { ...data.sourceSnapshot, files }
    const manifest = { entryPath: 'SKILL.md' as const, files }
    const { runMigrations } = await import('../../db/client')
    await runMigrations()
    const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
    const packageRecord = skillPackageRepo.createPackage({
      name: path.basename(data.skillDirectory), description: '', sourceType: data.source.kind,
      sourceUri: sourceUriFor(data.source), sourceRef: data.sourceSnapshot.sourceCommit ?? data.sourceSnapshot.sourceRef ?? null,
    })
    const versionRecord = skillPackageRepo.createVersion({
      packageId: packageRecord.id, version: manifestHash.slice(0, 12), manifest, manifestHash,
      packagePath: finalPath, sourceSnapshot,
    })
    const installationRecord = skillPackageRepo.createInstallation({
      packageId: packageRecord.id, currentVersionId: versionRecord.id, status: 'awaiting_permission_review', enabled: false,
    })
    return {
      packageId: packageRecord.id, versionId: versionRecord.id, installationId: installationRecord.id,
      status: 'awaiting_permission_review', sourceType: data.source.kind, relativeSkillPath, packagePath: finalPath,
      manifestHash, manifest, sourceSnapshot,
    }
  }
}

function getPackageRoots() {
  const root = path.join(getDataDir(), 'skills')
  return { root, packages: path.join(root, 'packages'), staging: path.join(root, 'staging') }
}

async function materializeSource(source: PackageInstallSource, target: string) {
  if (source.kind === 'local-directory') {
    const directory = path.resolve(source.directory)
    if (!fs.statSync(directory).isDirectory()) throw new PackageInstallError(`Local package directory not found: ${directory}`)
    copySafeDirectory(directory, target)
    return { sourceSha256: hashDirectory(target), sourceRef: directory }
  }
  if (source.kind === 'zip') {
    const zipPath = path.resolve(source.zipPath)
    if (!fs.statSync(zipPath).isFile()) throw new PackageInstallError(`ZIP package not found: ${zipPath}`)
    const archive = fs.readFileSync(zipPath)
    extractZip(archive, target)
    return { sourceSha256: hashBuffer(archive), sourceRef: zipPath }
  }
  const { owner, repository } = parseGitHubRepository(source.repositoryUrl)
  const commitResponse = await fetch(`https://api.github.com/repos/${owner}/${repository}/commits/${encodeURIComponent(source.ref)}`)
  if (!commitResponse.ok) throw new PackageInstallError(`Unable to resolve GitHub ref: ${source.ref}`)
  const commit = await commitResponse.json() as { sha?: unknown }
  if (typeof commit.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(commit.sha)) throw new PackageInstallError('GitHub did not return a valid commit SHA')
  const archiveResponse = await fetch(`https://github.com/${owner}/${repository}/archive/${commit.sha}.zip`)
  if (!archiveResponse.ok) throw new PackageInstallError(`Unable to download GitHub archive for ${commit.sha}`)
  const contentLength = Number(archiveResponse.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) throw new PackageInstallError('Archive exceeds the maximum allowed size')
  const archive = await readResponseBuffer(archiveResponse, MAX_ARCHIVE_BYTES)
  extractZip(archive, target)
  return { sourceSha256: hashBuffer(archive), sourceCommit: commit.sha, sourceRef: source.ref }
}

async function readResponseBuffer(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.from(await response.arrayBuffer())
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) throw new PackageInstallError('Archive exceeds the maximum allowed size')
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, totalBytes)
}

function parseGitHubRepository(repositoryUrl: string) {
  let url: URL
  try { url = new URL(repositoryUrl) } catch { throw new PackageInstallError('GitHub repository URL must be valid') }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') throw new PackageInstallError('Only https://github.com repository URLs are supported')
  const segments = url.pathname.split('/').filter(Boolean)
  const repository = segments[1]?.replace(/\.git$/, '')
  if (segments.length !== 2 || !/^[A-Za-z0-9_.-]+$/.test(segments[0]) || !repository || !/^[A-Za-z0-9_.-]+$/.test(repository)) throw new PackageInstallError('GitHub repository URL must identify exactly one owner and repository')
  return { owner: segments[0], repository }
}

function extractZip(archive: Buffer, target: string): void {
  if (archive.length > MAX_ARCHIVE_BYTES) throw new PackageInstallError('Archive exceeds the maximum allowed size')
  const entries = parseZipEntries(archive)
  if (entries.length > MAX_FILE_COUNT) throw new PackageInstallError('Archive contains too many files')
  let totalBytes = 0
  const seen = new Set<string>()
  for (const entry of entries) {
    const isDirectory = entry.name.endsWith('/')
    const name = normalizeArchivePath(entry.name)
    if (seen.has(name)) throw new PackageInstallError(`Archive contains duplicate file path: ${name}`)
    seen.add(name)
    if (entry.uncompressedSize > MAX_FILE_BYTES) throw new PackageInstallError(`Archive file exceeds the maximum size: ${name}`)
    totalBytes += entry.uncompressedSize
    if (totalBytes > MAX_UNPACKED_BYTES) throw new PackageInstallError('Archive expands beyond the maximum allowed size')
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
    if (entryStat.size > MAX_FILE_BYTES) throw new PackageInstallError(`Package file exceeds the maximum size: ${sourcePath}`)
    if (isSensitivePath(entry.name)) continue
    budget.fileCount += 1
    if (budget.fileCount > MAX_FILE_COUNT) throw new PackageInstallError('Package source contains too many files')
    budget.totalBytes += entryStat.size
    if (budget.totalBytes > MAX_UNPACKED_BYTES) throw new PackageInstallError('Package source exceeds the maximum allowed size')
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
  const files: Array<{ path: string; sha256: string; sizeBytes: number }> = []
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(fullPath)
      else if (entry.isFile()) { const stat = fs.statSync(fullPath); files.push({ path: normalizeRelative(path.relative(root, fullPath)), sha256: hashBuffer(fs.readFileSync(fullPath)), sizeBytes: stat.size }) }
    }
  }
  visit(root)
  return files.sort((a, b) => a.path.localeCompare(b.path))
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
  const normalized = value.replace(/\\/g, '/')
  const withoutTrailingSlash = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
  if (!withoutTrailingSlash || withoutTrailingSlash.startsWith('/') || /^[A-Za-z]:\//.test(withoutTrailingSlash)) throw new PackageInstallError(`Unsafe archive path: ${value}`)
  const pieces = withoutTrailingSlash.split('/')
  if (pieces.some((piece) => !piece || piece === '.' || piece === '..')) throw new PackageInstallError(`Unsafe archive path: ${value}`)
  return pieces.join('/')
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
