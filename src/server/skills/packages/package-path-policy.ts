import path from 'path'

export type PackagePathPolicy = {
  maxFileCount: number
  maxFileBytes: number
  maxUnpackedBytes: number
  maxArchiveBytes: number
  maxPathLength: number
  maxDepth: number
}

export const DEFAULT_PACKAGE_PATH_POLICY: PackagePathPolicy = {
  maxFileCount: 100_000,
  maxFileBytes: 100 * 1024 * 1024,
  maxUnpackedBytes: 1024 * 1024 * 1024,
  maxArchiveBytes: 1024 * 1024 * 1024,
  maxPathLength: 240,
  maxDepth: 32,
}

export class PackagePathPolicyError extends Error {
  readonly code: 'PATH_NOT_ALLOWED' | 'FILE_LIMIT_EXCEEDED'
  constructor(message: string, code: 'PATH_NOT_ALLOWED' | 'FILE_LIMIT_EXCEEDED' = 'PATH_NOT_ALLOWED') {
    super(message)
    this.name = 'PackagePathPolicyError'
    this.code = code
  }
}

export function normalizeSafeRelativePath(value: string, policy: PackagePathPolicy = DEFAULT_PACKAGE_PATH_POLICY): string {
  const normalized = value.replace(/\\/g, '/')
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new PackagePathPolicyError(`Path is not allowed: ${value}`)
  }
  const pieces = normalized.split('/')
  if (pieces.some((piece) => !piece || piece === '.' || piece === '..')) throw new PackagePathPolicyError(`Path is not allowed: ${value}`)
  if (normalized.length > policy.maxPathLength) throw new PackagePathPolicyError(`Path exceeds the maximum length: ${value}`)
  if (pieces.length > policy.maxDepth) throw new PackagePathPolicyError(`Path exceeds the maximum depth: ${value}`)
  return pieces.join('/')
}

export function assertArchiveEntryPath(value: string, policy: PackagePathPolicy = DEFAULT_PACKAGE_PATH_POLICY): string {
  return normalizeSafeRelativePath(value.replace(/\/$/, ''), policy)
}

export function isAllowedSnapshotPath(value: string): boolean {
  const normalized = value.replace(/\\/g, '/')
  if (normalized === 'SKILL.md' || normalized === 'manifest.json') return true
  if (!(normalized.startsWith('references/') || normalized.startsWith('assets/'))) return false
  const extension = path.posix.extname(normalized).toLowerCase()
  return extension === '' || ['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.csv', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(extension)
}

export function assertPackageBudget(input: { fileCount: number; totalBytes: number }, policy: PackagePathPolicy): void {
  if (input.fileCount > policy.maxFileCount || input.totalBytes > policy.maxUnpackedBytes) {
    throw new PackagePathPolicyError('Package exceeds the configured file budget', 'FILE_LIMIT_EXCEEDED')
  }
}
