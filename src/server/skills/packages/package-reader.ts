import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const DEFAULT_MAX_READ_BYTES = 1024 * 1024
const DEFAULT_MAX_FILES_PER_RUN = 32

export type LoadedPackageFile = {
  path: string
  sizeBytes: number
  sha256: string
}

export type ReadTextResult = LoadedPackageFile & {
  content: string
}

export type ReadAssetResult = LoadedPackageFile & {
  content: Buffer
}

export type SkillPackageReaderOptions = {
  maxReadBytes?: number
  maxFilesPerRun?: number
}

export type SkillPackageReaderCapability =
  | 'package.list_files'
  | 'package.read_text'
  | 'package.read_asset'

export type SkillPackageReaderCapabilityRequest = {
  capability: string
  input: Record<string, unknown>
}

export class SkillPackageReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillPackageReadError'
  }
}

export class SkillPackageReader {
  private readonly root: string
  private readonly maxReadBytes: number
  private readonly maxFilesPerRun: number
  private readonly loaded = new Map<string, LoadedPackageFile>()

  constructor(packagePath: string, options: SkillPackageReaderOptions = {}) {
    this.root = canonicalDirectory(packagePath)
    this.maxReadBytes = options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES
    this.maxFilesPerRun = options.maxFilesPerRun ?? DEFAULT_MAX_FILES_PER_RUN
    if (!Number.isInteger(this.maxReadBytes) || this.maxReadBytes <= 0) throw new SkillPackageReadError('maxReadBytes must be a positive integer')
    if (!Number.isInteger(this.maxFilesPerRun) || this.maxFilesPerRun <= 0) throw new SkillPackageReadError('maxFilesPerRun must be a positive integer')
  }

  listFiles(): string[] {
    const files: string[] = []
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name)
        const stat = fs.lstatSync(fullPath)
        if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw new SkillPackageReadError(`Package contains a non-regular file: ${this.toPackagePath(fullPath)}`)
        if (stat.isDirectory()) visit(fullPath)
        else files.push(this.toPackagePath(fullPath))
      }
    }
    visit(this.root)
    return files.sort()
  }

  readEntry(entryPath = 'SKILL.md'): ReadTextResult {
    return this.readTextFile(entryPath, 'entry')
  }

  readText(relativePath: string): ReadTextResult {
    return this.readTextFile(relativePath, 'text')
  }

  readAsset(relativePath: string): ReadAssetResult {
    const normalized = normalizePackagePath(relativePath)
    if (!normalized.startsWith('assets/')) throw new SkillPackageReadError(`Asset reads are limited to assets/: ${relativePath}`)
    const { buffer, metadata } = this.readFileBuffer(normalized)
    return { ...metadata, content: buffer }
  }

  executeCapability(request: SkillPackageReaderCapabilityRequest): { files: string[] } | ReadTextResult | ReadAssetResult {
    if (request.capability === 'package.list_files') return { files: this.listFiles() }
    if (request.capability === 'package.read_text') return this.readText(requiredInputPath(request.input, request.capability))
    if (request.capability === 'package.read_asset') return this.readAsset(requiredInputPath(request.input, request.capability))
    throw new SkillPackageReadError(`Unsupported package reader capability: ${request.capability}`)
  }

  loadedFiles(): LoadedPackageFile[] {
    return [...this.loaded.values()]
  }

  private readTextFile(relativePath: string, kind: 'entry' | 'text'): ReadTextResult {
    const normalized = normalizePackagePath(relativePath)
    if (kind === 'text' && normalized !== 'SKILL.md' && !normalized.startsWith('references/')) {
      throw new SkillPackageReadError(`Text reads are limited to SKILL.md and references/: ${relativePath}`)
    }
    const { buffer, metadata } = this.readFileBuffer(normalized)
    return { ...metadata, content: buffer.toString('utf8') }
  }

  private readFileBuffer(relativePath: string): { buffer: Buffer; metadata: LoadedPackageFile } {
    const fullPath = this.resolveFile(relativePath)
    const stat = fs.lstatSync(fullPath)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new SkillPackageReadError(`Package file must be a regular file: ${relativePath}`)
    if (stat.size > this.maxReadBytes) throw new SkillPackageReadError(`Package file exceeds the per-read size limit: ${relativePath}`)

    const buffer = fs.readFileSync(fullPath)
    if (buffer.length > this.maxReadBytes) throw new SkillPackageReadError(`Package file exceeds the per-read size limit: ${relativePath}`)
    const metadata = { path: relativePath, sizeBytes: buffer.length, sha256: hashBuffer(buffer) }
    this.recordLoadedFile(metadata)
    return { buffer, metadata }
  }

  private recordLoadedFile(file: LoadedPackageFile): void {
    if (!this.loaded.has(file.path) && this.loaded.size >= this.maxFilesPerRun) {
      throw new SkillPackageReadError('Package read exceeded the per-run file count limit')
    }
    this.loaded.set(file.path, file)
  }

  private resolveFile(relativePath: string): string {
    const fullPath = path.resolve(this.root, ...relativePath.split('/'))
    if (!isInsideCanonicalRoot(this.root, fullPath)) throw new SkillPackageReadError(`Package path escapes the package root: ${relativePath}`)
    let canonicalFile: string
    try {
      canonicalFile = fs.realpathSync.native(fullPath)
    } catch {
      throw new SkillPackageReadError(`Package file was not found: ${relativePath}`)
    }
    if (!isInsideCanonicalRoot(this.root, canonicalFile)) throw new SkillPackageReadError(`Package path escapes the package root: ${relativePath}`)
    return canonicalFile
  }

  private toPackagePath(fullPath: string): string {
    const canonicalPath = fs.realpathSync.native(fullPath)
    if (!isInsideCanonicalRoot(this.root, canonicalPath)) throw new SkillPackageReadError(`Package path escapes the package root: ${fullPath}`)
    return path.relative(this.root, canonicalPath).split(path.sep).join('/')
  }
}

function canonicalDirectory(directory: string): string {
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(directory)
  } catch {
    throw new SkillPackageReadError(`Package directory was not found: ${directory}`)
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new SkillPackageReadError(`Package path must be a directory: ${directory}`)
  return fs.realpathSync.native(directory)
}

function normalizePackagePath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new SkillPackageReadError(`Unsafe package path: ${value}`)
  const pieces = normalized.split('/')
  if (pieces.some((piece) => !piece || piece === '.' || piece === '..')) throw new SkillPackageReadError(`Unsafe package path: ${value}`)
  return pieces.join('/')
}

function isInsideCanonicalRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function hashBuffer(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function requiredInputPath(input: Record<string, unknown>, capability: string): string {
  if (typeof input.path !== 'string' || !input.path.trim()) throw new SkillPackageReadError(`A path is required for ${capability}`)
  return input.path
}
