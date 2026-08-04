import fs from 'node:fs'
import path from 'node:path'
import type { ToolExecutor } from './types'
import { allowedRootsFor, assertNotAborted, resolveToolPath } from './utils/tool-resource'

const BINARY_SAMPLE_BYTES = 4_096

export type FsStatInput = { path: string }
export type FsStatOutput = {
  path: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  modifiedAt: string
  extension?: string
  isBinary?: boolean
}

export const fsStatTool: ToolExecutor<FsStatInput, FsStatOutput> = async (input, context) => {
  const canonicalPath = await resolveToolPath(input.path, context, 'read')
  const rawPath = path.resolve(allowedRootsFor(context)[0] ?? process.cwd(), input.path)
  const linkStat = await fs.promises.lstat(rawPath)
  assertNotAborted(context)

  const type = linkStat.isSymbolicLink()
    ? 'symlink'
    : linkStat.isDirectory()
      ? 'directory'
      : 'file'
  const result: {
    path: string
    type: 'file' | 'directory' | 'symlink'
    size: number
    modifiedAt: string
    extension?: string
    isBinary?: boolean
  } = {
    path: canonicalPath,
    type,
    size: type === 'file' ? linkStat.size : 0,
    modifiedAt: linkStat.mtime.toISOString(),
  }

  const extension = path.extname(rawPath)
  if (extension) result.extension = extension
  if (type === 'file') result.isBinary = await isBinaryFile(canonicalPath, context.signal)
  return result
}

async function isBinaryFile(filePath: string, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) throw signal.reason ?? new Error('Tool execution cancelled')
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(BINARY_SAMPLE_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (signal?.aborted) throw signal.reason ?? new Error('Tool execution cancelled')
    for (let index = 0; index < bytesRead; index += 1) {
      if (buffer[index] === 0) return true
    }
    return false
  } finally {
    await handle.close()
  }
}
