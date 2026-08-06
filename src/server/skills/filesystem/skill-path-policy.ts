import fs from 'node:fs'
import path from 'node:path'

export type SkillPathPolicyErrorCode =
  | 'PATH_NOT_ALLOWED'
  | 'ROOT_NOT_FOUND'
  | 'SYMLINK_NOT_ALLOWED'
  | 'EXPORT_DESTINATION_NOT_ALLOWED'

export class SkillPathPolicyError extends Error {
  readonly name = 'SkillPathPolicyError'

  constructor(
    message: string,
    readonly code: SkillPathPolicyErrorCode = 'PATH_NOT_ALLOWED',
  ) {
    super(message)
  }
}

/**
 * Validates an application-owned directory root. Roots are deliberately not
 * allowed to be symlinks/junctions so a persisted path cannot be redirected
 * outside the configured data/project boundary between calls.
 */
export function assertReadableWorkspace(rootPath: string): string {
  return canonicalDirectory(rootPath, 'workspace')
}

/** Alias used by package readers and other filesystem adapters. */
export const assertReadableDirectory = assertReadableWorkspace

export function resolveArtifactRunDirectory(artifactRoot: string, runId: string): string {
  const root = canonicalDirectory(artifactRoot, 'artifact root')
  assertSafeSegment(runId, 'run id')
  const target = path.resolve(root, runId)
  assertInside(root, target, 'run directory')
  assertNoSymlinkComponents(root, target)
  return target
}

export function resolveExportDestination(
  exportRoot: string,
  destinationDir = exportRoot,
  additionalAllowedRoots: readonly string[] = [],
): string {
  const roots = [exportRoot, ...additionalAllowedRoots].map((root) => canonicalDirectory(root, 'export root'))
  if (hasUnsafeWindowsPrefix(destinationDir) || !path.isAbsolute(destinationDir)) {
    throw new SkillPathPolicyError('Export destination must be an absolute local directory', 'EXPORT_DESTINATION_NOT_ALLOWED')
  }

  const resolved = path.resolve(destinationDir)
  const matchingRoot = roots.find((root) => isInside(root, resolved))
  if (!matchingRoot) {
    throw new SkillPathPolicyError('Export destination must be inside an allowed export root', 'EXPORT_DESTINATION_NOT_ALLOWED')
  }
  assertNoSymlinkComponents(matchingRoot, resolved)
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(resolved)
  } catch {
    throw new SkillPathPolicyError(`Export destination does not exist: ${destinationDir}`, 'EXPORT_DESTINATION_NOT_ALLOWED')
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new SkillPathPolicyError('Export destination must be a regular directory', 'EXPORT_DESTINATION_NOT_ALLOWED')
  }
  return fs.realpathSync.native(resolved)
}

export function cleanupRunArtifacts(artifactRoot: string, runId: string): boolean {
  const root = canonicalDirectory(artifactRoot, 'artifact root')
  assertSafeSegment(runId, 'run id')
  const target = path.resolve(root, runId)
  assertInside(root, target, 'run directory')
  if (!fs.existsSync(target)) return false
  assertNoSymlinkComponents(root, target)
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new SkillPathPolicyError('Run artifact directory must be a regular directory', 'SYMLINK_NOT_ALLOWED')
  }
  fs.rmSync(target, { recursive: true, force: true })
  return true
}

export function isInsidePath(rootPath: string, targetPath: string): boolean {
  return isInside(path.resolve(rootPath), path.resolve(targetPath))
}

function canonicalDirectory(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim() || hasUnsafeWindowsPrefix(value) || !path.isAbsolute(value)) {
    throw new SkillPathPolicyError(`${label} must be an absolute local directory`)
  }
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(value)
  } catch {
    throw new SkillPathPolicyError(`${label} does not exist: ${value}`, 'ROOT_NOT_FOUND')
  }
  if (stat.isSymbolicLink()) {
    throw new SkillPathPolicyError(`${label} cannot be a symbolic link or junction: ${value}`, 'SYMLINK_NOT_ALLOWED')
  }
  if (!stat.isDirectory()) throw new SkillPathPolicyError(`${label} must be a directory: ${value}`, 'ROOT_NOT_FOUND')
  const canonical = fs.realpathSync.native(value)
  if (canonical !== path.resolve(value)) {
    throw new SkillPathPolicyError(`${label} resolves outside its lexical path`, 'SYMLINK_NOT_ALLOWED')
  }
  return canonical
}

function assertSafeSegment(value: string, label: string): void {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value === '.'
    || value === '..'
    || path.basename(value) !== value
    || path.isAbsolute(value)
    || value.includes('/')
    || value.includes('\\')
    || value.includes('\0')
  ) {
    throw new SkillPathPolicyError(`Unsafe ${label}: ${value}`)
  }
}

function assertInside(root: string, target: string, label: string): void {
  if (!isInside(root, target)) throw new SkillPathPolicyError(`${label} escapes its configured root`)
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function assertNoSymlinkComponents(root: string, target: string): void {
  assertInside(root, target, 'path')
  const relative = path.relative(root, target)
  let current = root
  for (const part of relative ? relative.split(path.sep) : []) {
    current = path.join(current, part)
    if (!fs.existsSync(current)) continue
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) {
      throw new SkillPathPolicyError(`Path component cannot be a symbolic link or junction: ${current}`, 'SYMLINK_NOT_ALLOWED')
    }
  }
}

function hasUnsafeWindowsPrefix(value: string): boolean {
  return /^(?:\\\\|\/\/|\\\\\?\\|\\\\\.\\)/.test(value)
}
