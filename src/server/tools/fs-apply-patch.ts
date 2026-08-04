import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ToolExecutor } from './types'
import { allowedRootsFor, assertNotAborted, resolveToolPath } from './utils/tool-resource'

export type ApplyPatchInput = {
  patch: string
  root?: string
  dryRun?: boolean
  createBackup?: boolean
  expectedHash?: string
  expectedHashes?: Record<string, string>
}

type ParsedFilePatch = {
  relativePath: string
  hunks: ParsedHunk[]
}

type ParsedHunk = {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: string[]
}

type PatchPlan = {
  source: ParsedFilePatch
  filePath: string
  existed: boolean
  original: string
  updated: string
  linesAdded: number
  linesRemoved: number
}

type RollbackEntry = { filePath: string; backupPath?: string; existed: boolean }

export type FsApplyPatchOutput = {
  dryRun: boolean
  applied: boolean
  files: Array<{
    path: string
    relativePath: string
    hunks: number
    linesAdded: number
    linesRemoved: number
    backupPath?: string
    rollbackToken?: string
  }>
  conflicts: Array<{ path?: string; relativePath: string; reason: string; detail?: string }>
  rollbackToken?: string
}

const rollbackStore = new Map<string, RollbackEntry[]>()

export const fsApplyPatchTool: ToolExecutor<ApplyPatchInput, FsApplyPatchOutput> = async (input, context) => {
  const dryRun = input.dryRun ?? true
  const createBackup = input.createBackup ?? true
  const rootPath = input.root
    ? await resolveToolPath(input.root, context, 'read')
    : await resolveToolPath('.', context, 'read')
  const parsedFiles = parseUnifiedPatch(input.patch)
  const plans: PatchPlan[] = []
  const conflicts: Array<{ path?: string; relativePath: string; reason: string; detail?: string }> = []

  for (const source of parsedFiles) {
    assertRelativePatchPath(source.relativePath)
    const filePath = await resolveToolPath(path.join(rootPath, source.relativePath), context, 'write')
    const exists = await pathExists(filePath)
    let original = ''
    if (exists) {
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) {
        conflicts.push({ path: filePath, relativePath: source.relativePath, reason: 'not_a_file' })
        continue
      }
      original = await fs.promises.readFile(filePath, 'utf8')
    } else if (source.hunks.some((hunk) => hunk.oldCount > 0)) {
      conflicts.push({ path: filePath, relativePath: source.relativePath, reason: 'missing_file' })
      continue
    }

    const expectedHash = input.expectedHashes?.[source.relativePath] ?? (
      parsedFiles.length === 1 ? input.expectedHash : undefined
    )
    if (expectedHash && sha256(original) !== expectedHash) {
      conflicts.push({
        path: filePath,
        relativePath: source.relativePath,
        reason: 'expected_hash_mismatch',
      })
      continue
    }

    try {
      const result = applyFilePatch(original, source.hunks)
      plans.push({
        source,
        filePath,
        existed: exists,
        original,
        updated: result.updated,
        linesAdded: result.linesAdded,
        linesRemoved: result.linesRemoved,
      })
    } catch (error) {
      conflicts.push({
        path: filePath,
        relativePath: source.relativePath,
        reason: 'hunk_mismatch',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const fileSummaries = plans.map((plan) => ({
    path: plan.filePath,
    relativePath: plan.source.relativePath,
    hunks: plan.source.hunks.length,
    linesAdded: plan.linesAdded,
    linesRemoved: plan.linesRemoved,
  }))
  if (conflicts.length > 0 || dryRun) {
    return {
      dryRun,
      applied: false,
      files: fileSummaries,
      conflicts,
    }
  }

  const rollbackToken = randomUUID()
  const rollbackEntries: RollbackEntry[] = []
  const writeConflicts = await detectPlanConflicts(plans, rootPath, context)
  if (writeConflicts.length > 0) {
    return {
      dryRun: false,
      applied: false,
      files: fileSummaries,
      conflicts: writeConflicts,
    }
  }

  try {
    for (const plan of plans) {
      assertNotAborted(context)
      const backupPath = createBackup && plan.existed
        ? `${plan.filePath}.bak-${rollbackToken}`
        : undefined
      if (backupPath) await fs.promises.copyFile(plan.filePath, backupPath)
      rollbackEntries.push({ filePath: plan.filePath, backupPath, existed: plan.existed })
      await atomicWrite(plan.filePath, plan.updated, rollbackToken)
    }
  } catch (error) {
    await rollbackEntriesFromDisk(rollbackEntries)
    throw error
  }
  rollbackStore.set(rollbackToken, rollbackEntries)

  return {
    dryRun: false,
    applied: true,
    files: plans.map((plan, index) => ({
      ...fileSummaries[index],
      ...(createBackup && plan.existed ? { backupPath: `${plan.filePath}.bak-${rollbackToken}` } : {}),
      rollbackToken,
    })),
    conflicts: [],
    rollbackToken,
  }
}

async function detectPlanConflicts(
  plans: readonly PatchPlan[],
  rootPath: string,
  context: Parameters<ToolExecutor>[1],
): Promise<Array<{ path?: string; relativePath: string; reason: string; detail?: string }>> {
  const conflicts: Array<{ path?: string; relativePath: string; reason: string; detail?: string }> = []
  for (const plan of plans) {
    assertNotAborted(context)
    const currentPath = await resolveToolPath(path.join(rootPath, plan.source.relativePath), context, 'write')
    if (currentPath !== plan.filePath) {
      conflicts.push({
        path: currentPath,
        relativePath: plan.source.relativePath,
        reason: 'path_changed_since_plan',
      })
      continue
    }

    const exists = await pathExists(currentPath)
    if (exists !== plan.existed) {
      conflicts.push({
        path: currentPath,
        relativePath: plan.source.relativePath,
        reason: 'file_changed_since_plan',
      })
      continue
    }
    if (!exists) continue

    const stat = await fs.promises.stat(currentPath)
    if (!stat.isFile()) {
      conflicts.push({
        path: currentPath,
        relativePath: plan.source.relativePath,
        reason: 'not_a_file',
      })
      continue
    }
    const current = await fs.promises.readFile(currentPath, 'utf8')
    if (sha256(current) !== sha256(plan.original)) {
      conflicts.push({
        path: currentPath,
        relativePath: plan.source.relativePath,
        reason: 'file_changed_since_plan',
      })
    }
  }
  return conflicts
}

export async function rollbackFsPatch(token: string): Promise<boolean> {
  const entries = rollbackStore.get(token)
  if (!entries) return false
  await rollbackEntriesFromDisk(entries)
  rollbackStore.delete(token)
  return true
}

function parseUnifiedPatch(value: string): ParsedFilePatch[] {
  const lines = value.replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  const files: ParsedFilePatch[] = []
  let index = 0
  while (index < lines.length) {
    if (!lines[index].startsWith('--- ')) throw new Error('Patch must start each file with a --- header')
    const oldPath = parsePatchPath(lines[index].slice(4))
    index += 1
    if (!lines[index]?.startsWith('+++ ')) throw new Error('Patch is missing a +++ header')
    const newPath = parsePatchPath(lines[index].slice(4))
    index += 1
    if (oldPath !== newPath && oldPath !== '/dev/null') throw new Error('Patch source and destination paths differ')
    const relativePath = newPath === '/dev/null' ? oldPath : newPath
    const hunks: ParsedHunk[] = []
    while (index < lines.length && !lines[index].startsWith('--- ')) {
      const header = lines[index]
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header)
      if (!match) throw new Error(`Invalid hunk header: ${header}`)
      index += 1
      const hunkLines: string[] = []
      while (index < lines.length && !lines[index].startsWith('@@ ') && !lines[index].startsWith('--- ')) {
        const line = lines[index]
        if (!line.startsWith(' ') && !line.startsWith('+') && !line.startsWith('-') && !line.startsWith('\\')) {
          throw new Error(`Invalid patch line: ${line}`)
        }
        if (!line.startsWith('\\')) hunkLines.push(line)
        index += 1
      }
      hunks.push({
        oldStart: Number(match[1]),
        oldCount: Number(match[2] ?? 1),
        newStart: Number(match[3]),
        newCount: Number(match[4] ?? 1),
        lines: hunkLines,
      })
    }
    if (hunks.length === 0) throw new Error(`Patch has no hunks for ${relativePath}`)
    files.push({ relativePath, hunks })
  }
  return files
}

function parsePatchPath(value: string): string {
  const raw = value.split('\t', 1)[0].trim().replace(/\\/g, '/')
  if (raw === '/dev/null') return raw
  const stripped = raw.replace(/^(?:a|b)\//, '')
  assertRelativePatchPath(stripped)
  return stripped
}

function assertRelativePatchPath(value: string): void {
  if (!value || value === '/dev/null' || value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('//')) {
    throw new Error(`Patch path must be relative: ${value}`)
  }
  if (value.split(/[\\/]/).some((segment) => segment === '..')) {
    throw new Error(`Patch path cannot contain parent traversal: ${value}`)
  }
}

function applyFilePatch(original: string, hunks: ParsedHunk[]): {
  updated: string
  linesAdded: number
  linesRemoved: number
} {
  const newline = original.includes('\r\n') ? '\r\n' : '\n'
  const hadFinalNewline = original.endsWith('\n')
  const lines = original.replace(/\r\n/g, '\n').split('\n')
  if (hadFinalNewline) lines.pop()
  let offset = 0
  let linesAdded = 0
  let linesRemoved = 0

  for (const hunk of hunks) {
    const oldLines = hunk.lines.filter((line) => line.startsWith(' ') || line.startsWith('-')).map((line) => line.slice(1))
    const newLines = hunk.lines.filter((line) => line.startsWith(' ') || line.startsWith('+')).map((line) => line.slice(1))
    const start = Math.max(0, hunk.oldStart - 1 + offset)
    const actual = lines.slice(start, start + oldLines.length)
    if (actual.length !== oldLines.length || actual.some((line, index) => line !== oldLines[index])) {
      throw new Error(`Hunk context mismatch at line ${hunk.oldStart}`)
    }
    lines.splice(start, oldLines.length, ...newLines)
    offset += newLines.length - oldLines.length
    linesAdded += hunk.lines.filter((line) => line.startsWith('+')).length
    linesRemoved += hunk.lines.filter((line) => line.startsWith('-')).length
  }

  const updatedBody = lines.join(newline)
  return {
    updated: updatedBody + (hadFinalNewline ? newline : ''),
    linesAdded,
    linesRemoved,
  }
}

async function atomicWrite(filePath: string, content: string, token: string): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${token}`
  try {
    await fs.promises.writeFile(temporaryPath, content, 'utf8')
    await fs.promises.rename(temporaryPath, filePath)
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

async function rollbackEntriesFromDisk(entries: readonly RollbackEntry[]): Promise<void> {
  for (const entry of [...entries].reverse()) {
    if (entry.backupPath && await pathExists(entry.backupPath)) {
      await fs.promises.rename(entry.backupPath, entry.filePath).catch(async () => {
        await fs.promises.rm(entry.filePath, { force: true })
        await fs.promises.rename(entry.backupPath!, entry.filePath)
      })
    } else if (!entry.existed) {
      await fs.promises.rm(entry.filePath, { force: true })
    }
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.lstat(filePath)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT') return false
    throw error
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
