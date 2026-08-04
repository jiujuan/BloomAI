import fs from 'node:fs'
import path from 'node:path'
import type { ToolExecutor } from './types'
import { assertNotAborted, resolveToolPath } from './utils/tool-resource'

const MAX_SCAN_FILES = 2_000
const MAX_DEPTH = 20
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_READ_BYTES = 20 * 1024 * 1024
const MAX_PREVIEW_CHARS = 400
const DEFAULT_IGNORED_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.vite',
  '.cache',
  '.config',
  'target',
])

export type WorkspaceSearchInput = {
  query: string
  include?: string | string[]
  exclude?: string | string[]
  root?: string
  caseSensitive?: boolean
  maxResults?: number
  cursor?: string
  mode?: 'text' | 'files'
}

export type SearchResult = {
  file: string
  relativePath: string
  line?: number
  column?: number
  preview?: string
  ranges?: Array<{ start: number; end: number }>
  size?: number
  modifiedAt?: string
}

export type WorkspaceSearchOutput = {
  mode: 'text' | 'files'
  results: SearchResult[]
  total: number
  scannedFiles: number
  skippedFiles: number
  resourceLimited: boolean
  truncated: boolean
  nextCursor?: string
}

export const workspaceSearchTool: ToolExecutor<WorkspaceSearchInput, WorkspaceSearchOutput> = async (input, context) => {
  const mode = input.mode ?? 'text'
  const caseSensitive = input.caseSensitive ?? false
  const maxResults = input.maxResults ?? 100
  const rootPath = input.root
    ? await resolveToolPath(input.root, context, 'read')
    : await resolveToolPath('.', context, 'read')
  const include = asPatterns(input.include, ['**/*'])
  const exclude = asPatterns(input.exclude, [])
  const start = Number(input.cursor ?? 0)
  const results: SearchResult[] = []
  let scannedFiles = 0
  let skippedFiles = 0
  let totalReadBytes = 0
  let resourceLimited = false

  const walk = async (directory: string, depth: number): Promise<boolean> => {
    assertNotAborted(context)
    if (depth > MAX_DEPTH) {
      resourceLimited = true
      return false
    }

    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true })
    } catch {
      skippedFiles += 1
      return true
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      assertNotAborted(context)
      const absolutePath = path.join(directory, entry.name)
      const relativePath = toRelativePath(rootPath, absolutePath)
      if (entry.isSymbolicLink()) {
        skippedFiles += 1
        continue
      }
      if (entry.isDirectory()) {
        if (shouldIgnoreDirectory(entry.name, relativePath, exclude)) continue
        if (!(await walk(absolutePath, depth + 1))) return false
        continue
      }
      if (!entry.isFile()) {
        skippedFiles += 1
        continue
      }
      if (scannedFiles >= MAX_SCAN_FILES) {
        resourceLimited = true
        return false
      }
      scannedFiles += 1
      if (!matchesAnyGlob(relativePath, include)) continue
      if (matchesAnyGlob(relativePath, exclude)) {
        skippedFiles += 1
        continue
      }

      const stat = await fs.promises.stat(absolutePath)
      if (stat.size > MAX_FILE_BYTES || totalReadBytes + stat.size > MAX_TOTAL_READ_BYTES) {
        skippedFiles += 1
        resourceLimited = true
        if (totalReadBytes + stat.size > MAX_TOTAL_READ_BYTES) return false
        continue
      }
      if (mode === 'files') {
        if (input.query && !matchesAnyGlob(relativePath, [input.query])) continue
        results.push({
          file: absolutePath,
          relativePath,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        })
        if (results.length >= start + maxResults + 1) return false
        continue
      }

      const buffer = await fs.promises.readFile(absolutePath)
      totalReadBytes += buffer.byteLength
      assertNotAborted(context)
      if (isBinaryBuffer(buffer)) {
        skippedFiles += 1
        continue
      }
      const content = buffer.toString('utf8')
      const matches = findTextMatches(content, input.query, caseSensitive)
      for (const match of matches) {
        results.push({
          file: absolutePath,
          relativePath,
          line: match.line,
          column: match.column + 1,
          preview: match.preview,
          ranges: match.ranges,
        })
        if (results.length >= start + maxResults + 1) return false
      }
    }
    return true
  }

  await walk(rootPath, 0)
  const page = results.slice(start, start + maxResults)
  const hasNext = results.length > start + maxResults
  return {
    mode,
    results: page,
    total: results.length,
    scannedFiles,
    skippedFiles,
    resourceLimited,
    truncated: resourceLimited || hasNext,
    ...(hasNext ? { nextCursor: String(start + maxResults) } : {}),
  }
}

function asPatterns(value: string | string[] | undefined, fallback: string[]): string[] {
  if (value === undefined) return fallback
  return Array.isArray(value) ? value : [value]
}

function toRelativePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function shouldIgnoreDirectory(name: string, relativePath: string, exclude: string[]): boolean {
  if (DEFAULT_IGNORED_NAMES.has(name)) return true
  return matchesAnyGlob(relativePath, exclude)
}

function matchesAnyGlob(value: string, patterns: string[]): boolean {
  const basename = path.posix.basename(value)
  return patterns.some((pattern) => {
    const normalised = pattern.replace(/\\/g, '/').replace(/^\.\/+/, '')
    if (!normalised) return false
    const expression = globToRegExp(normalised)
    return expression.test(value) || (!normalised.includes('/') && expression.test(basename))
  })
}

function globToRegExp(pattern: string): RegExp {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '*' && pattern[index + 1] === '*') {
      index += 1
      if (pattern[index + 1] === '/') {
        index += 1
        source += '(?:.*/)?'
      } else {
        source += '.*'
      }
    } else if (character === '*') {
      source += '[^/]*'
    } else if (character === '?') {
      source += '[^/]'
    } else if (character === '[') {
      const end = pattern.indexOf(']', index + 1)
      if (end > index) {
        source += pattern.slice(index, end + 1)
        index = end
      } else {
        source += '\\['
      }
    } else {
      source += escapeRegExp(character)
    }
  }
  return new RegExp(`${source}$`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*.?]/g, '\\$&')
}

function findTextMatches(content: string, query: string, caseSensitive: boolean): Array<{
  line: number
  column: number
  preview: string
  ranges: Array<{ start: number; end: number }>
}> {
  if (!query) return []
  const lines = content.split(/\r?\n/)
  const needle = caseSensitive ? query : query.toLocaleLowerCase()
  const matches: Array<{
    line: number
    column: number
    preview: string
    ranges: Array<{ start: number; end: number }>
  }> = []
  lines.forEach((line, lineIndex) => {
    const haystack = caseSensitive ? line : line.toLocaleLowerCase()
    const ranges: Array<{ start: number; end: number }> = []
    let offset = 0
    while (needle.length > 0) {
      const found = haystack.indexOf(needle, offset)
      if (found < 0) break
      ranges.push({ start: found, end: found + needle.length })
      offset = found + needle.length
    }
    if (ranges.length > 0) {
      matches.push({
        line: lineIndex + 1,
        column: ranges[0].start,
        preview: line.slice(0, MAX_PREVIEW_CHARS),
        ranges,
      })
    }
  })
  return matches
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8_192)
  for (const byte of sample) {
    if (byte === 0) return true
  }
  return false
}
