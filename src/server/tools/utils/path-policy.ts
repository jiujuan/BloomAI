import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type PathAccess = 'read' | 'write'

export type PathPolicyContext = {
  allowedRoots: readonly string[]
  access: PathAccess
  createParents?: boolean
  baseDir?: string
}

export class PathPolicyError extends Error {
  constructor(message: string) {
    super(`Path policy denied: ${message}`)
    this.name = 'PathPolicyError'
  }
}

export async function resolvePathWithinAllowedRoots(rawPath: string, context: PathPolicyContext): Promise<string> {
  if (!rawPath || !rawPath.trim()) throw new PathPolicyError('path is required')
  if (rawPath.includes('\0')) throw new PathPolicyError('NUL bytes are not allowed')
  if (isDeviceOrSchemePath(rawPath)) throw new PathPolicyError('device and URL paths are not allowed')
  if (!context.allowedRoots.length) throw new PathPolicyError('at least one approved root is required')

  const expanded = expandHome(rawPath)
  const baseDir = context.baseDir ?? context.allowedRoots[0] ?? process.cwd()
  const candidate = path.resolve(baseDir, expanded)
  const roots = await Promise.all(context.allowedRoots.map((root) => realpathDirectory(root)))

  let canonicalTarget: string
  if (context.access === 'read') {
    canonicalTarget = await realpathExisting(candidate)
  } else {
    canonicalTarget = await canonicalWriteTarget(candidate, context.createParents === true)
  }

  if (!roots.some((root) => isWithinRoot(canonicalTarget, root))) {
    throw new PathPolicyError('resolved path is outside approved roots')
  }
  return canonicalTarget
}

async function canonicalWriteTarget(candidate: string, createParents: boolean): Promise<string> {
  try {
    return await fs.promises.realpath(candidate)
  } catch (error) {
    if (!isMissingPath(error)) throw error
    const { path: parent, missingSegments } = await findExistingParent(path.dirname(candidate))
    if (!createParents && missingSegments.length > 0) {
      throw new PathPolicyError('parent directory does not exist')
    }
    const canonicalParent = await realpathExisting(parent)
    return path.join(canonicalParent, ...missingSegments, path.basename(candidate))
  }
}

async function findExistingParent(start: string): Promise<{ path: string; missingSegments: string[] }> {
  let current = start
  const missingSegments: string[] = []
  while (true) {
    try {
      const stat = await fs.promises.stat(current)
      if (!stat.isDirectory()) throw new PathPolicyError(`parent is not a directory: ${current}`)
      return { path: current, missingSegments: missingSegments.reverse() }
    } catch (error) {
      if (!isMissingPath(error)) throw error
      const parent = path.dirname(current)
      if (parent === current) throw new PathPolicyError('no existing parent directory')
      missingSegments.push(path.basename(current))
      current = parent
    }
  }
}

async function realpathDirectory(value: string): Promise<string> {
  const canonical = await realpathExisting(path.resolve(expandHome(value)))
  const stat = await fs.promises.stat(canonical)
  if (!stat.isDirectory()) throw new PathPolicyError(`approved root is not a directory: ${value}`)
  return canonical
}

async function realpathExisting(value: string): Promise<string> {
  try {
    return await fs.promises.realpath(value)
  } catch (error) {
    if (isMissingPath(error)) throw new PathPolicyError(`path does not exist: ${value}`)
    throw error
  }
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir()
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

function isWithinRoot(candidate: string, root: string): boolean {
  const normalisedCandidate = normaliseForComparison(candidate)
  const normalisedRoot = normaliseForComparison(root)
  const relative = path.relative(normalisedRoot, normalisedCandidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function normaliseForComparison(value: string): string {
  const normalised = path.normalize(value)
  return process.platform === 'win32' ? normalised.toLowerCase() : normalised
}

function isDeviceOrSchemePath(value: string): boolean {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return true
  if (/^(?:\\\\[.?]\\|\\\\\?\\)/.test(value)) return true
  if (/^(?:nul|con|prn|aux|clock\$|com[1-9]|lpt[1-9])(?:[.:/\\]|$)/i.test(value.trim())) return true
  if (/^[a-z]:[^/\\]/i.test(value)) return true
  return false
}

function isMissingPath(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT'
}
