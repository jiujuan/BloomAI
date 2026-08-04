import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ToolExecutor } from './types'
import { allowedRootsFor, assertFileSizeWithinLimit, assertNotAborted } from './utils/tool-resource'
import { PathPolicyError, resolvePathWithinAllowedRoots } from './utils/path-policy'

const MAX_PATCH_BYTES = 1_000_000
const MAX_FILE_BYTES = 5 * 1024 * 1024

export type FsApplyPatchInput = {
  patch: string
  root?: string
  dryRun?: boolean
  createBackup?: boolean
}

export type FsApplyPatchFileResult = {
  path: string
  relativePath: string
  status: 'modified' | 'created' | 'deleted' | 'conflict'
  hunks: number
  additions: number
  deletions: number
  preview: string
  conflict?: string
  backupPath?: string
}

export type FsApplyPatchOutput = {
  dryRun: boolean
  applied: boolean
  files: FsApplyPatchFileResult[]
  modifiedFiles: string[]
  conflicts: Array<{ path: string; reason: string }>
  backupPaths: string[]
  rollbackToken?: string
}

type ParsedFilePatch = {
  oldPath: string
  newPath: string
  hunks: ParsedHunk[]
}

type ParsedHunk = {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: Array<{ kind: 'context' | 'add' | 'remove'; text: string }>
}

type ResolvedFilePatch = ParsedFilePatch & {
  targetPath: string
  relativePath: string
  originalContent: string
  nextContent: string
  originalExists: boolean
  originalHash?: string
  nextHash: string
  status: 'modified' | 'created' | 'deleted'
}

type PatchResolution = {
  resolved: ResolvedFilePatch[]
  conflicts: Array<{ path: string; reason: string }>
  conflictFiles: FsApplyPatchFileResult[]
}

type RollbackEntry = {
  targetPath: string
  backupPath?: string
  originalExists: boolean
  appliedExists: boolean
  appliedHash: string
}

type RollbackRecord = {
  rootPath: string
  entries: RollbackEntry[]
}

const rollbackRecords = new Map<string, RollbackRecord>()

export const fsApplyPatchTool: ToolExecutor<FsApplyPatchInput, FsApplyPatchOutput> = async (input, context) => {
  const patchBytes = Buffer.byteLength(input.patch, 'utf8')
  if (patchBytes > MAX_PATCH_BYTES) throw new Error(`Patch exceeds the ${MAX_PATCH_BYTES}-byte tool limit`)
  assertNotAborted(context)

  const rootPath = await resolvePatchRoot(input.root, context)
  const parsedPatches = parseUnifiedPatch(input.patch)
  const resolution = await resolveAndApplyPatches(parsedPatches, rootPath, context)
  const resolvedPatches = resolution.resolved
  const fileResults: FsApplyPatchFileResult[] = [
    ...resolution.conflictFiles,
    ...resolvedPatches.map((file) => ({
      path: file.targetPath,
      relativePath: file.relativePath,
      status: file.status,
      hunks: file.hunks.length,
      additions: countPatchLines(file.hunks, 'add'),
      deletions: countPatchLines(file.hunks, 'remove'),
      preview: createPreview(file),
    })),
  ]

  const conflicts: Array<{ path: string; reason: string }> = [...resolution.conflicts]
  for (const file of resolvedPatches) {
    const latest = await readCurrentSnapshot(file.targetPath)
    if (latest.exists !== file.originalExists || (latest.exists && latest.hash !== file.originalHash)) {
      const reason = 'File changed after the patch snapshot was read'
      conflicts.push({ path: file.relativePath, reason })
      const result = fileResults.find((item) => item.path === file.targetPath)
      if (result) {
        result.status = 'conflict'
        result.conflict = reason
      }
    }
  }

  if (conflicts.length > 0) {
    return {
      dryRun: input.dryRun !== false,
      applied: false,
      files: fileResults,
      modifiedFiles: [],
      conflicts,
      backupPaths: [],
    }
  }

  if (input.dryRun !== false) {
    return {
      dryRun: true,
      applied: false,
      files: fileResults,
      modifiedFiles: [],
      conflicts: [],
      backupPaths: [],
    }
  }

  const createBackup = input.createBackup !== false
  const applied = await applyResolvedPatches(resolvedPatches, rootPath, context, createBackup)
  const backups = applied.entries.filter((entry) => entry.backupPath)
  const rollbackable = applied.entries.length > 0
    && applied.entries.every((entry) => !entry.originalExists || !!entry.backupPath)
  const rollbackToken = rollbackable ? randomUUID() : undefined
  if (rollbackToken) rollbackRecords.set(rollbackToken, { rootPath, entries: applied.entries })

  return {
    dryRun: false,
    applied: true,
    files: fileResults.map((result) => {
      const entry = applied.entries.find((item) => item.targetPath === result.path)
      return {
        ...result,
        backupPath: entry?.backupPath ? relativeToRoot(entry.backupPath, rootPath) : undefined,
      }
    }),
    modifiedFiles: resolvedPatches.map((file) => file.relativePath),
    conflicts: [],
    backupPaths: backups.map((entry) => relativeToRoot(entry.backupPath!, rootPath)),
    ...(rollbackToken ? { rollbackToken } : {}),
  }
}

export async function rollbackFsApplyPatch(token: string, context: Parameters<ToolExecutor>[1]): Promise<{ restoredFiles: string[] }> {
  const record = rollbackRecords.get(token)
  if (!record) throw new Error('Rollback token is invalid or expired')
  assertNotAborted(context)

  const restoredFiles: string[] = []
  for (const entry of record.entries) {
    const targetPath = await resolvePathWithinAllowedRoots(entry.targetPath, {
      allowedRoots: allowedRootsFor(context),
      access: 'write',
      createParents: true,
    })
    const latest = await readCurrentSnapshot(targetPath)
    if (latest.exists !== entry.appliedExists || (latest.exists && latest.hash !== entry.appliedHash)) {
      throw new Error(`Rollback conflict: ${path.basename(targetPath)} changed after the patch was applied`)
    }

    if (entry.originalExists) {
      if (!entry.backupPath) throw new Error(`Rollback backup is missing for ${path.basename(targetPath)}`)
      const backupPath = await resolvePathWithinAllowedRoots(entry.backupPath, {
        allowedRoots: allowedRootsFor(context),
        access: 'read',
      })
      await atomicReplace(backupPath, targetPath, context)
    } else {
      await fs.promises.rm(targetPath, { force: true })
    }
    restoredFiles.push(targetPath)
  }

  rollbackRecords.delete(token)
  return { restoredFiles }
}

function parseUnifiedPatch(patch: string): ParsedFilePatch[] {
  const lines = patch.replace(/\r\n/g, '\n').split('\n')
  const files: ParsedFilePatch[] = []
  let index = 0

  while (index < lines.length) {
    if (!lines[index].startsWith('--- ')) {
      index += 1
      continue
    }

    const oldPath = parsePatchPath(lines[index].slice(4))
    index += 1
    if (!lines[index]?.startsWith('+++ ')) throw new Error('Invalid unified patch: missing new file header')
    const newPath = parsePatchPath(lines[index].slice(4))
    index += 1
    const hunks: ParsedHunk[] = []

    while (index < lines.length && !lines[index].startsWith('--- ')) {
      if (!lines[index]) {
        index += 1
        continue
      }
      if (!lines[index].startsWith('@@ ')) {
        index += 1
        continue
      }

      const header = parseHunkHeader(lines[index])
      index += 1
      const hunkLines: ParsedHunk['lines'] = []
      while (index < lines.length && !lines[index].startsWith('@@ ') && !lines[index].startsWith('--- ')) {
        const line = lines[index]
        index += 1
        if (line.startsWith('\\')) continue
        const kind = line[0]
        if (kind === ' ') hunkLines.push({ kind: 'context', text: line.slice(1) })
        else if (kind === '+') hunkLines.push({ kind: 'add', text: line.slice(1) })
        else if (kind === '-') hunkLines.push({ kind: 'remove', text: line.slice(1) })
        else throw new Error(`Invalid unified patch hunk line: ${line}`)
      }

      const oldLines = hunkLines.filter((line) => line.kind !== 'add').length
      const newLines = hunkLines.filter((line) => line.kind !== 'remove').length
      if (oldLines !== header.oldCount || newLines !== header.newCount) {
        throw new Error(`Invalid unified patch hunk count near line ${header.line}`)
      }
      hunks.push({
        oldStart: header.oldStart,
        oldCount: header.oldCount,
        newStart: header.newStart,
        newCount: header.newCount,
        lines: hunkLines,
      })
    }

    if (hunks.length === 0) throw new Error(`Invalid unified patch: no hunks for ${newPath}`)
    files.push({ oldPath, newPath, hunks })
  }

  if (files.length === 0) throw new Error('Unified patch does not contain any file hunks')
  return files
}

function parsePatchPath(value: string): string {
  const raw = value.split('\t', 1)[0].trim()
  if (raw === '/dev/null') return raw
  if (!raw || raw.includes('\0')) throw new Error('Patch file path is required')
  const withoutPrefix = raw.replace(/^(?:a|b)\//, '')
  if (path.isAbsolute(withoutPrefix) || /^[a-zA-Z]:[\\/]/.test(withoutPrefix) || withoutPrefix.startsWith('//')) {
    throw new PathPolicyError('patch paths must be relative')
  }
  const segments = withoutPrefix.replace(/\\/g, '/').split('/')
  if (segments.some((segment) => segment === '..')) throw new PathPolicyError('patch paths cannot escape the approved root')
  if (segments.some((segment) => segment === '')) throw new PathPolicyError('patch paths cannot contain empty segments')
  return segments.join('/')
}

function parseHunkHeader(value: string): { oldStart: number; oldCount: number; newStart: number; newCount: number; line: string } {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(value)
  if (!match) throw new Error(`Invalid unified patch hunk header: ${value}`)
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? 1),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? 1),
    line: value,
  }
}

async function resolvePatchRoot(root: string | undefined, context: Parameters<ToolExecutor>[1]): Promise<string> {
  const rootPath = root
    ? await resolvePathWithinAllowedRoots(root, { allowedRoots: allowedRootsFor(context), access: 'read' })
    : await resolvePathWithinAllowedRoots('.', { allowedRoots: allowedRootsFor(context), access: 'read' })
  const stat = await fs.promises.stat(rootPath)
  if (!stat.isDirectory()) throw new PathPolicyError('patch root must be a directory')
  return rootPath
}

async function resolveAndApplyPatches(
  patches: ParsedFilePatch[],
  rootPath: string,
  context: Parameters<ToolExecutor>[1],
): Promise<PatchResolution> {
  const resolved: ResolvedFilePatch[] = []
  const conflicts: Array<{ path: string; reason: string }> = []
  const conflictFiles: FsApplyPatchFileResult[] = []
  const seenTargets = new Set<string>()
  for (const patch of patches) {
    const patchPath = patch.newPath === '/dev/null' ? patch.oldPath : patch.newPath
    if (patchPath === '/dev/null') throw new Error('Patch cannot delete and create /dev/null')
    const targetPath = await resolvePathWithinAllowedRoots(patchPath, {
      allowedRoots: allowedRootsFor(context),
      access: 'write',
      createParents: true,
      baseDir: rootPath,
    })
    if (seenTargets.has(targetPath)) {
      const relativePath = relativeToRoot(targetPath, rootPath)
      const reason = 'Patch contains multiple file sections for the same target'
      conflicts.push({ path: relativePath, reason })
      conflictFiles.push({
        path: targetPath,
        relativePath,
        status: 'conflict',
        hunks: patch.hunks.length,
        additions: countPatchLines(patch.hunks, 'add'),
        deletions: countPatchLines(patch.hunks, 'remove'),
        preview: createPreview({
          ...patch,
          targetPath,
          relativePath,
          originalContent: '',
          nextContent: '',
          originalExists: false,
          nextHash: sha256(''),
          status: 'created',
        }),
        conflict: reason,
      })
      continue
    }
    seenTargets.add(targetPath)
    const originalExists = patch.oldPath !== '/dev/null'
    const originalContent = originalExists ? await readPatchFile(targetPath, context) : ''
    let nextContent: string
    try {
      nextContent = applyHunks(originalContent, patch.hunks, originalExists)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Patch hunk does not match the current file'
      const relativePath = relativeToRoot(targetPath, rootPath)
      conflicts.push({ path: relativePath, reason })
      conflictFiles.push({
        path: targetPath,
        relativePath,
        status: 'conflict',
        hunks: patch.hunks.length,
        additions: countPatchLines(patch.hunks, 'add'),
        deletions: countPatchLines(patch.hunks, 'remove'),
        preview: createPreview({
          ...patch,
          targetPath,
          relativePath,
          originalContent,
          nextContent: originalContent,
          originalExists,
          originalHash: originalExists ? sha256(originalContent) : undefined,
          nextHash: sha256(originalContent),
          status: originalExists ? 'modified' : 'created',
        }),
        conflict: reason,
      })
      continue
    }
    const status = patch.newPath === '/dev/null'
      ? 'deleted'
      : originalExists
        ? 'modified'
        : 'created'
    resolved.push({
      ...patch,
      targetPath,
      relativePath: relativeToRoot(targetPath, rootPath),
      originalContent,
      nextContent,
      originalExists,
      originalHash: originalExists ? sha256(originalContent) : undefined,
      nextHash: sha256(nextContent),
      status,
    })
  }
  return { resolved, conflicts, conflictFiles }
}

function applyHunks(content: string, hunks: ParsedHunk[], originalExists: boolean): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const hadFinalNewline = content.endsWith('\n')
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  if (hadFinalNewline) lines.pop()
  if (!originalExists && lines.length === 1 && lines[0] === '') lines.pop()

  let offset = 0
  for (const hunk of hunks) {
    const expectedIndex = Math.max(0, hunk.oldStart - 1) + offset
    let cursor = expectedIndex
    const replacement: string[] = []
    for (const line of hunk.lines) {
      if (line.kind === 'add') {
        replacement.push(line.text)
        continue
      }
      if (lines[cursor] !== line.text) {
        throw new Error(`Patch conflict near line ${hunk.oldStart}: expected ${JSON.stringify(line.text)}`)
      }
      if (line.kind === 'context') replacement.push(line.text)
      cursor += 1
    }
    lines.splice(expectedIndex, cursor - expectedIndex, ...replacement)
    offset += replacement.length - (cursor - expectedIndex)
  }

  const result = lines.join('\n')
  if (hadFinalNewline || !originalExists) return `${result}${newline}`
  return result
}

async function readPatchFile(filePath: string, context: Parameters<ToolExecutor>[1]): Promise<string> {
  await assertFileSizeWithinLimit(filePath, context, MAX_FILE_BYTES)
  const content = await fs.promises.readFile(filePath, 'utf8')
  assertNotAborted(context)
  if (content.includes('\0')) throw new Error(`Binary files are not supported: ${path.basename(filePath)}`)
  return content
}

async function readCurrentSnapshot(filePath: string): Promise<{ exists: boolean; hash?: string }> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8')
    return { exists: true, hash: sha256(content) }
  } catch (error) {
    if (isMissingPath(error)) return { exists: false }
    throw error
  }
}

async function applyResolvedPatches(
  patches: ResolvedFilePatch[],
  rootPath: string,
  context: Parameters<ToolExecutor>[1],
  createBackup: boolean,
): Promise<{ entries: RollbackEntry[] }> {
  const entries: RollbackEntry[] = []
  try {
    for (const file of patches) {
      assertNotAborted(context)
      const backupPath = createBackup && file.originalExists
        ? await createBackupFile(file.targetPath, context)
        : undefined
      if (file.status === 'deleted') {
        await fs.promises.rm(file.targetPath, { force: true })
        assertNotAborted(context)
      } else {
        await atomicWrite(file.targetPath, file.nextContent, context, file.originalExists)
      }
      entries.push({
        targetPath: file.targetPath,
        backupPath,
        originalExists: file.originalExists,
        appliedExists: file.status !== 'deleted',
        appliedHash: file.nextHash,
      })
    }
    return { entries }
  } catch (error) {
    await rollbackEntries(entries, context).catch(() => {})
    throw error
  }
}

async function createBackupFile(filePath: string, context: Parameters<ToolExecutor>[1]): Promise<string> {
  const backupPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.bloomai-backup`)
  await fs.promises.copyFile(filePath, backupPath)
  assertNotAborted(context)
  return backupPath
}

async function atomicWrite(
  filePath: string,
  content: string,
  context: Parameters<ToolExecutor>[1],
  targetExists: boolean,
): Promise<void> {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.bloomai-tmp`)
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(tempPath, content, 'utf8')
    assertNotAborted(context)
    if (targetExists) await fs.promises.rm(filePath, { force: true })
    await fs.promises.rename(tempPath, filePath)
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {})
  }
}

async function atomicReplace(sourcePath: string, targetPath: string, context: Parameters<ToolExecutor>[1]): Promise<void> {
  const content = await fs.promises.readFile(sourcePath, 'utf8')
  await atomicWrite(targetPath, content, context, true)
}

async function rollbackEntries(entries: RollbackEntry[], context: Parameters<ToolExecutor>[1]): Promise<void> {
  for (const entry of [...entries].reverse()) {
    if (entry.originalExists && entry.backupPath) {
      await atomicReplace(entry.backupPath, entry.targetPath, context)
      await fs.promises.rm(entry.backupPath, { force: true })
    } else {
      await fs.promises.rm(entry.targetPath, { force: true })
    }
  }
}

function createPreview(file: ResolvedFilePatch): string {
  const lines = [
    `--- ${file.relativePath}`,
    `+++ ${file.relativePath}`,
    ...file.hunks.map((hunk) => `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`),
  ]
  return lines.join('\n')
}

function countPatchLines(hunks: ParsedHunk[], kind: 'add' | 'remove'): number {
  return hunks.reduce((count, hunk) => count + hunk.lines.filter((line) => line.kind === kind).length, 0)
}

function relativeToRoot(filePath: string, rootPath: string): string {
  const relative = path.relative(rootPath, filePath).split(path.sep).join('/')
  return relative || '.'
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function isMissingPath(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT'
}
