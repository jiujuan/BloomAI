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
  imagePath: string
  bytes: number
  mimeType: ScreenshotArtifactInput['mimeType']
}

export type ScreenshotArtifactPathInput = Pick<ScreenshotArtifactInput, 'dataDir' | 'runId' | 'mimeType'>

export function createScreenshotArtifactPath(input: ScreenshotArtifactPathInput): string {
  const root = path.resolve(input.dataDir)
  const directory = path.join(root, 'tool-artifacts', 'web-screenshot', safeRunId(input.runId))
  const extension = input.mimeType === 'image/jpeg' ? 'jpg' : 'png'
  const imagePath = path.join(directory, `screenshot.${extension}`)
  const relative = path.relative(root, imagePath)
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Screenshot artifact path escaped the application data directory')
  }
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

  const runId = safeRunId(input.runId)
  const imagePath = createScreenshotArtifactPath({ ...input, runId })
  const directory = path.dirname(imagePath)
  const temporaryPath = path.join(directory, `.${path.basename(imagePath)}.${randomUUID()}.tmp`)

  await fs.promises.mkdir(directory, { recursive: true })
  try {
    throwIfAborted(input.signal)
    await fs.promises.writeFile(temporaryPath, input.bytes, { flag: 'wx' })
    throwIfAborted(input.signal)
    await replaceArtifactFile(temporaryPath, imagePath)
    if (input.signal?.aborted) {
      await fs.promises.rm(imagePath, { force: true })
      throwIfAborted(input.signal)
    }
    await pruneScreenshotArtifacts({
      dataDir: input.dataDir,
      maxRuns: input.retentionCount ?? 20,
      keepRunId: runId,
    })
    return { imagePath, bytes: input.bytes.byteLength, mimeType: input.mimeType }
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
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
    if (!entry.isDirectory() || !/^[A-Za-z0-9._-]{1,128}$/.test(entry.name)) continue
    const candidatePath = path.join(directory, entry.name)
    const stats = await fs.promises.stat(candidatePath)
    candidates.push({ name: entry.name, mtimeMs: stats.mtimeMs })
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)

  const keep = new Set(candidates.slice(0, maxRuns).map((candidate) => candidate.name))
  if (input.keepRunId) keep.add(safeRunId(input.keepRunId))
  for (const candidate of candidates) {
    if (keep.has(candidate.name)) continue
    const candidatePath = path.join(directory, candidate.name)
    const relative = path.relative(root, candidatePath)
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue
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

function safeRunId(value: string | undefined): string {
  return value && /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : randomUUID()
}
