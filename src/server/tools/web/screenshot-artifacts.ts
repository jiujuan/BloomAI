import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { WebBrowserError } from './browser-errors'

export type ScreenshotArtifactInput = {
  bytes: Buffer
  mimeType: 'image/png' | 'image/jpeg'
  dataDir: string
  runId?: string
  maxBytes: number
  signal?: AbortSignal
  retentionCount?: number
}

export type ScreenshotArtifact = {
  runId: string
  relativePath: string
  bytes: number
  mimeType: ScreenshotArtifactInput['mimeType']
}

export type ScreenshotArtifactPathInput = Pick<ScreenshotArtifactInput, 'dataDir' | 'runId' | 'mimeType'>
export type ScreenshotArtifactReadInput = {
  dataDir: string
  runId: string
  relativePath: string
}
export type ScreenshotArtifactContent = {
  bytes: Buffer
  bytesCount: number
  mimeType: ScreenshotArtifactInput['mimeType']
  runId: string
  relativePath: string
}

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const ARTIFACT_RELATIVE_PATTERN = /^tool-artifacts\/web-screenshot\/([A-Za-z0-9._-]{1,128})\/screenshot\.(png|jpg)$/

export function createScreenshotArtifactPath(input: ScreenshotArtifactPathInput): string {
  const root = path.resolve(input.dataDir)
  const directory = path.join(root, 'tool-artifacts', 'web-screenshot', normalizeWriteRunId(input.runId))
  const extension = input.mimeType === 'image/jpeg' ? 'jpg' : 'png'
  const imagePath = path.join(directory, `screenshot.${extension}`)
  assertWithinDataDir(root, imagePath)
  return imagePath
}

export function enforceScreenshotLimits(bytes: Buffer, maxBytes: number): void {
  if (bytes.byteLength > maxBytes) {
    throw new WebBrowserError(
      'WEB_SCREENSHOT_LIMIT_EXCEEDED',
      `screenshot artifact exceeds the ${maxBytes}-byte limit`,
    )
  }
}

export async function writeScreenshotArtifact(input: ScreenshotArtifactInput): Promise<ScreenshotArtifact> {
  enforceScreenshotLimits(input.bytes, input.maxBytes)
  throwIfAborted(input.signal)

  const runId = normalizeWriteRunId(input.runId)
  const imagePath = createScreenshotArtifactPath({ ...input, runId })
  const directory = path.dirname(imagePath)
  const temporaryPath = path.join(directory, `.${path.basename(imagePath)}.${randomUUID()}.tmp`)

  await fs.promises.mkdir(directory, { recursive: true })
  try {
    await assertNoSymlinkComponents(path.resolve(input.dataDir), [
      'tool-artifacts',
      'web-screenshot',
      runId,
    ])
    await assertRegularOrMissingFile(imagePath)
    throwIfAborted(input.signal)
    await fs.promises.writeFile(temporaryPath, input.bytes, { flag: 'wx' })
    throwIfAborted(input.signal)
    await replaceArtifactFile(temporaryPath, imagePath)
    await assertReadableArtifactPath(path.resolve(input.dataDir), runId, imagePath)
    if (input.signal?.aborted) {
      await fs.promises.rm(imagePath, { force: true })
      throwIfAborted(input.signal)
    }
    await pruneScreenshotArtifacts({
      dataDir: input.dataDir,
      maxRuns: input.retentionCount ?? 20,
      keepRunId: runId,
    })
    return {
      runId,
      relativePath: toRelativeArtifactPath(path.resolve(input.dataDir), imagePath),
      bytes: input.bytes.byteLength,
      mimeType: input.mimeType,
    }
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function readScreenshotArtifact(input: ScreenshotArtifactReadInput): Promise<ScreenshotArtifactContent> {
  const root = path.resolve(input.dataDir)
  const runId = assertRunId(input.runId)
  const match = parseArtifactRelativePath(input.relativePath)
  if (match.runId !== runId) throw new Error('Screenshot artifact path does not belong to the requested run')

  const imagePath = path.resolve(root, ...input.relativePath.split('/'))
  assertWithinDataDir(root, imagePath)
  await assertNoSymlinkComponents(root, ['tool-artifacts', 'web-screenshot', runId])
  await assertReadableArtifactPath(root, runId, imagePath)

  const bytes = await fs.promises.readFile(imagePath)
  const mimeType = match.extension === 'jpg' ? 'image/jpeg' : 'image/png'
  return {
    bytes,
    bytesCount: bytes.byteLength,
    mimeType,
    runId,
    relativePath: input.relativePath,
  }
}

export async function pruneScreenshotArtifacts(input: {
  dataDir: string
  maxRuns: number
  keepRunId?: string
}): Promise<void> {
  const maxRuns = Math.max(1, Math.floor(input.maxRuns))
  const root = path.resolve(input.dataDir)
  const directory = path.join(root, 'tool-artifacts', 'web-screenshot')
  const entries = await fs.promises.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []
    throw error
  })
  const candidates: Array<{ name: string; mtimeMs: number }> = []
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory() || !RUN_ID_PATTERN.test(entry.name)) continue
    const candidatePath = path.join(directory, entry.name)
    const stats = await fs.promises.lstat(candidatePath)
    candidates.push({ name: entry.name, mtimeMs: stats.mtimeMs })
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)

  const keep = new Set(candidates.slice(0, maxRuns).map((candidate) => candidate.name))
  if (input.keepRunId && RUN_ID_PATTERN.test(input.keepRunId)) keep.add(input.keepRunId)
  for (const candidate of candidates) {
    if (keep.has(candidate.name)) continue
    const candidatePath = path.join(directory, candidate.name)
    assertWithinDataDir(root, candidatePath)
    await fs.promises.rm(candidatePath, { recursive: true, force: true })
  }
}

async function replaceArtifactFile(temporaryPath: string, imagePath: string): Promise<void> {
  try {
    await fs.promises.rename(temporaryPath, imagePath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code !== 'EEXIST' && code !== 'EPERM') throw error
    await fs.promises.rm(imagePath, { force: true })
    await fs.promises.rename(temporaryPath, imagePath)
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new WebBrowserError('WEB_BROWSER_ABORTED', 'screenshot artifact write was cancelled', signal.reason)
  }
}

function normalizeWriteRunId(value: string | undefined): string {
  return value && RUN_ID_PATTERN.test(value) ? value : randomUUID()
}

function assertRunId(value: string): string {
  if (!RUN_ID_PATTERN.test(value)) throw new Error('Invalid screenshot artifact run id')
  return value
}

function parseArtifactRelativePath(value: string): { runId: string; extension: 'png' | 'jpg' } {
  if (!value || value.includes('\\') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new Error('Screenshot artifact path must be a relative controlled path')
  }
  const match = ARTIFACT_RELATIVE_PATTERN.exec(value)
  if (!match) throw new Error('Screenshot artifact path is outside the controlled tool directory')
  return { runId: match[1], extension: match[2] as 'png' | 'jpg' }
}

function toRelativeArtifactPath(root: string, imagePath: string): string {
  const relative = path.relative(root, imagePath)
  assertWithinDataDir(root, imagePath)
  return relative.split(path.sep).join('/')
}

function assertWithinDataDir(root: string, target: string): void {
  const relative = path.relative(root, target)
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Screenshot artifact path escaped the application data directory')
  }
}

async function assertNoSymlinkComponents(root: string, components: string[]): Promise<void> {
  let current = root
  for (const component of components) {
    current = path.join(current, component)
    try {
      const stats = await fs.promises.lstat(current)
      if (stats.isSymbolicLink()) throw new Error('Screenshot artifact path cannot contain symlinks')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return
      throw error
    }
  }
}

async function assertRegularOrMissingFile(filePath: string): Promise<void> {
  try {
    const stats = await fs.promises.lstat(filePath)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error('Screenshot artifact target must be a regular file')
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return
    throw error
  }
}

async function assertReadableArtifactPath(root: string, runId: string, imagePath: string): Promise<void> {
  assertWithinDataDir(root, imagePath)
  const relativePath = toRelativeArtifactPath(root, imagePath)
  const parsed = parseArtifactRelativePath(relativePath)
  if (parsed.runId !== runId) throw new Error('Screenshot artifact path does not belong to the requested run')
  const stats = await fs.promises.lstat(imagePath)
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error('Screenshot artifact must be a regular file')
  }
  const [realRoot, realPath] = await Promise.all([
    fs.promises.realpath(root),
    fs.promises.realpath(imagePath),
  ])
  const realRelative = path.relative(realRoot, realPath)
  if (realRelative.startsWith(`..${path.sep}`) || realRelative === '..' || path.isAbsolute(realRelative)) {
    throw new Error('Screenshot artifact real path escaped the application data directory')
  }
}
