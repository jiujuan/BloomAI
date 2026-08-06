import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { DEFAULT_PACKAGE_PATH_POLICY, normalizeSafeRelativePath, type PackagePathPolicy, assertPackageBudget } from './package-path-policy'

const DEFAULT_MAX_READ_BYTES = 1024 * 1024
const DEFAULT_MAX_FILES_PER_RUN = 32

export type LoadedPackageFile = {
  path: string
  sizeBytes: number
  sha256: string
}

export type ReadTextResult = LoadedPackageFile & { content: string }
export type ReadAssetResult = LoadedPackageFile & { content: Buffer }
export type SkillPackageReaderOptions = Partial<PackagePathPolicy> & {
  maxReadBytes?: number
  maxFilesPerRun?: number
}
export type SkillPackageReaderCapability = 'package.list_files' | 'package.read_text' | 'package.read_asset'
export type SkillPackageReaderCapabilityRequest = { capability: string; input: Record<string, unknown> }

export class SkillPackageReadError extends Error {
  readonly code: 'PATH_NOT_ALLOWED' | 'FILE_LIMIT_EXCEEDED' | 'PACKAGE_READ_ERROR'
  constructor(message: string, code: 'PATH_NOT_ALLOWED' | 'FILE_LIMIT_EXCEEDED' | 'PACKAGE_READ_ERROR' = 'PACKAGE_READ_ERROR') {
    super(message)
    this.name = 'SkillPackageReadError'
    this.code = code
  }
}

export class SkillPackageReader {
  private readonly root: string
  private readonly maxReadBytes: number
  private readonly maxFilesPerRun: number
  private readonly policy: PackagePathPolicy
  private readonly loaded = new Map<string, LoadedPackageFile>()
  private loadedBytes = 0
  private closed = false

  constructor(packagePath: string, options: SkillPackageReaderOptions = {}) {
    this.root = canonicalDirectory(packagePath)
    this.maxReadBytes = positiveInt(options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES, 'maxReadBytes')
    this.maxFilesPerRun = positiveInt(options.maxFilesPerRun ?? DEFAULT_MAX_FILES_PER_RUN, 'maxFilesPerRun')
    this.policy = {
      ...DEFAULT_PACKAGE_PATH_POLICY,
      ...options,
      maxFileBytes: options.maxFileBytes ?? Math.min(DEFAULT_PACKAGE_PATH_POLICY.maxFileBytes, this.maxReadBytes),
    }
    for (const [key, value] of Object.entries(this.policy)) if (!Number.isInteger(value) || value <= 0) throw new SkillPackageReadError(`${key} must be a positive integer`)
  }

  listFiles(): string[] {
    this.assertOpen()
    const files: string[] = []
    let totalBytes = 0
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name)
        const stat = fs.lstatSync(fullPath)
        const packagePath = this.toPackagePath(fullPath)
        if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw new SkillPackageReadError(`Package contains a non-regular file: ${packagePath}`, 'PATH_NOT_ALLOWED')
        if (stat.isDirectory()) visit(fullPath)
        else {
          this.checkFileBudget(packagePath, stat.size)
          files.push(packagePath)
          totalBytes += stat.size
          try { assertPackageBudget({ fileCount: files.length, totalBytes }, this.policy) }
          catch (error) { throw new SkillPackageReadError(error instanceof Error ? error.message : 'Package exceeds the configured file budget', 'FILE_LIMIT_EXCEEDED') }
        }
      }
    }
    visit(this.root)
    return files.sort()
  }

  readEntry(entryPath = 'SKILL.md', maxBytes?: number): ReadTextResult { return this.readTextFile(entryPath, 'entry', maxBytes) }
  readText(relativePath: string, maxBytes?: number): ReadTextResult { return this.readTextFile(relativePath, 'text', maxBytes) }

  readBuffer(relativePath: string, maxBytes?: number): ReadAssetResult {
    this.assertOpen()
    const normalized = this.safePath(relativePath)
    const { buffer, metadata } = this.readFileBuffer(normalized, maxBytes)
    return { ...metadata, content: buffer }
  }

  readAsset(relativePath: string, maxBytes?: number): ReadAssetResult {
    const normalized = this.safePath(relativePath)
    if (!normalized.startsWith('assets/')) throw new SkillPackageReadError(`Asset reads are limited to assets/: ${relativePath}`, 'PATH_NOT_ALLOWED')
    return this.readBuffer(normalized, maxBytes)
  }

  getFingerprint(): string {
    this.assertOpen()
    const files = this.listFiles().map((file) => {
      const fullPath = this.resolveFile(file)
      const buffer = fs.readFileSync(fullPath)
      return { path: file, sizeBytes: buffer.length, sha256: hashBuffer(buffer) }
    })
    return hashBuffer(Buffer.from(JSON.stringify(files.sort((a, b) => a.path.localeCompare(b.path)))))
  }

  close(): void { this.closed = true }
  executeCapability(request: SkillPackageReaderCapabilityRequest): { files: string[] } | ReadTextResult | ReadAssetResult {
    if (request.capability === 'package.list_files') return { files: this.listFiles() }
    if (request.capability === 'package.read_text') return this.readText(requiredInputPath(request.input, request.capability))
    if (request.capability === 'package.read_asset') return this.readAsset(requiredInputPath(request.input, request.capability))
    throw new SkillPackageReadError(`Unsupported package reader capability: ${request.capability}`)
  }
  loadedFiles(): LoadedPackageFile[] { return [...this.loaded.values()] }

  private readTextFile(relativePath: string, kind: 'entry' | 'text', maxBytes?: number): ReadTextResult {
    this.assertOpen()
    const normalized = this.safePath(relativePath)
    if (kind === 'text' && normalized !== 'SKILL.md' && normalized !== 'manifest.json' && !normalized.startsWith('references/')) {
      throw new SkillPackageReadError(`Text reads are limited to SKILL.md, manifest.json, and references/: ${relativePath}`, 'PATH_NOT_ALLOWED')
    }
    const { buffer, metadata } = this.readFileBuffer(normalized, maxBytes)
    return { ...metadata, content: buffer.toString('utf8') }
  }

  private readFileBuffer(relativePath: string, maxBytes?: number): { buffer: Buffer; metadata: LoadedPackageFile } {
    this.assertOpen()
    const fullPath = this.resolveFile(relativePath)
    const stat = fs.lstatSync(fullPath)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new SkillPackageReadError(`Package file must be a regular file: ${relativePath}`, 'PATH_NOT_ALLOWED')
    const allowedBytes = Math.min(maxBytes ?? this.maxReadBytes, this.maxReadBytes, this.policy.maxFileBytes)
    if (!Number.isInteger(allowedBytes) || allowedBytes <= 0) throw new SkillPackageReadError('maxBytes must be a positive integer', 'FILE_LIMIT_EXCEEDED')
    if (stat.size > allowedBytes) throw new SkillPackageReadError(`Package file exceeds the per-read size limit: ${relativePath}`, 'FILE_LIMIT_EXCEEDED')
    const buffer = fs.readFileSync(fullPath)
    if (buffer.length > allowedBytes) throw new SkillPackageReadError(`Package file exceeds the per-read size limit: ${relativePath}`, 'FILE_LIMIT_EXCEEDED')
    this.checkFileBudget(relativePath, buffer.length)
    const metadata = { path: relativePath, sizeBytes: buffer.length, sha256: hashBuffer(buffer) }
    this.recordLoadedFile(metadata)
    return { buffer, metadata }
  }

  private recordLoadedFile(file: LoadedPackageFile): void {
    if (!this.loaded.has(file.path)) {
      if (this.loaded.size >= this.maxFilesPerRun) throw new SkillPackageReadError('Package read exceeded the per-run file count limit', 'FILE_LIMIT_EXCEEDED')
      if (this.loadedBytes + file.sizeBytes > this.policy.maxUnpackedBytes) throw new SkillPackageReadError('Package read exceeded the total byte limit', 'FILE_LIMIT_EXCEEDED')
      this.loadedBytes += file.sizeBytes
    }
    this.loaded.set(file.path, file)
  }

  private checkFileBudget(relativePath: string, sizeBytes: number): void {
    try { normalizeSafeRelativePath(relativePath, this.policy) } catch (error) { throw new SkillPackageReadError(error instanceof Error ? error.message : 'Path is not allowed', 'PATH_NOT_ALLOWED') }
    if (sizeBytes > this.policy.maxFileBytes) throw new SkillPackageReadError(`Package file exceeds the maximum size: ${relativePath}`, 'FILE_LIMIT_EXCEEDED')
  }

  private safePath(relativePath: string): string {
    try { return normalizeSafeRelativePath(relativePath, this.policy) } catch (error) { throw new SkillPackageReadError(error instanceof Error ? error.message : 'Path is not allowed', 'PATH_NOT_ALLOWED') }
  }

  private resolveFile(relativePath: string): string {
    const fullPath = path.resolve(this.root, ...relativePath.split('/'))
    if (!isInsideCanonicalRoot(this.root, fullPath)) throw new SkillPackageReadError(`Package path escapes the package root: ${relativePath}`, 'PATH_NOT_ALLOWED')
    let canonicalFile: string
    try { canonicalFile = fs.realpathSync.native(fullPath) } catch { throw new SkillPackageReadError(`Package file was not found: ${relativePath}`, 'PATH_NOT_ALLOWED') }
    if (!isInsideCanonicalRoot(this.root, canonicalFile)) throw new SkillPackageReadError(`Package path escapes the package root: ${relativePath}`, 'PATH_NOT_ALLOWED')
    return canonicalFile
  }

  private toPackagePath(fullPath: string): string {
    const canonicalPath = fs.realpathSync.native(fullPath)
    if (!isInsideCanonicalRoot(this.root, canonicalPath)) throw new SkillPackageReadError(`Package path escapes the package root: ${fullPath}`, 'PATH_NOT_ALLOWED')
    return normalizeSafeRelativePath(path.relative(this.root, canonicalPath).split(path.sep).join('/'), this.policy)
  }
  private assertOpen(): void { if (this.closed) throw new SkillPackageReadError('Package reader is closed') }
}

function canonicalDirectory(directory: string): string {
  let stat: fs.Stats
  try { stat = fs.lstatSync(directory) } catch { throw new SkillPackageReadError(`Package directory was not found: ${directory}`, 'PATH_NOT_ALLOWED') }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new SkillPackageReadError(`Package path must be a directory: ${directory}`, 'PATH_NOT_ALLOWED')
  return fs.realpathSync.native(directory)
}
function isInsideCanonicalRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}
function hashBuffer(value: Buffer): string { return crypto.createHash('sha256').update(value).digest('hex') }
function positiveInt(value: number, name: string): number { if (!Number.isInteger(value) || value <= 0) throw new SkillPackageReadError(`${name} must be a positive integer`, 'FILE_LIMIT_EXCEEDED'); return value }
function requiredInputPath(input: Record<string, unknown>, capability: string): string { if (typeof input.path !== 'string' || !input.path.trim()) throw new SkillPackageReadError(`A path is required for ${capability}`, 'PATH_NOT_ALLOWED'); return input.path }
