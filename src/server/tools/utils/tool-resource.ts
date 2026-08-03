import fs from 'node:fs'
import path from 'node:path'
import type { ToolExecutionContext } from '../types'
import { resolvePathWithinAllowedRoots, type PathAccess } from './path-policy'

export const DEFAULT_ALLOWED_ROOT = process.cwd()
export const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024

export function allowedRootsFor(context: ToolExecutionContext): readonly string[] {
  return context.allowedRoots?.length ? context.allowedRoots : [DEFAULT_ALLOWED_ROOT]
}

export async function resolveToolPath(
  rawPath: string,
  context: ToolExecutionContext,
  access: PathAccess,
  createParents = false,
): Promise<string> {
  return resolvePathWithinAllowedRoots(rawPath, {
    allowedRoots: allowedRootsFor(context),
    access,
    createParents,
  })
}

export type LimitedText = {
  text: string
  bytesRead: number
  truncated: boolean
}

export async function readTextFileLimited(
  filePath: string,
  context: ToolExecutionContext,
  maxBytes = DEFAULT_MAX_FILE_BYTES,
): Promise<LimitedText> {
  assertNotAborted(context)
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    assertNotAborted(context)
    return {
      text: buffer.subarray(0, Math.min(bytesRead, maxBytes)).toString('utf8'),
      bytesRead,
      truncated: bytesRead > maxBytes,
    }
  } finally {
    await handle.close()
  }
}

export async function assertFileSizeWithinLimit(
  filePath: string,
  context: ToolExecutionContext,
  maxBytes = DEFAULT_MAX_FILE_BYTES,
): Promise<number> {
  assertNotAborted(context)
  const stat = await fs.promises.stat(filePath)
  if (stat.size > maxBytes) throw new Error(`File exceeds the ${maxBytes}-byte tool limit`)
  return stat.size
}

export function assertNotAborted(context: ToolExecutionContext): void {
  if (context.signal?.aborted) throw context.signal.reason ?? new Error('Tool execution cancelled')
}

export function relativeToAllowedRoot(filePath: string, context: ToolExecutionContext): string {
  const root = allowedRootsFor(context)[0] ?? DEFAULT_ALLOWED_ROOT
  return path.relative(root, filePath)
}
