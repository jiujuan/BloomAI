import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { workspaceSearchTool } from './workspace-search'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function context(root: string) {
  return { toolId: 'workspace_search', allowedRoots: [root] as const }
}

describe('workspace_search', () => {
  it('searches text with glob filters, line metadata and match ranges', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-workspace-search-'))
    tempDirectories.push(root)
    fs.mkdirSync(path.join(root, 'src'))
    fs.mkdirSync(path.join(root, 'node_modules'))
    fs.mkdirSync(path.join(root, '.git'))
    fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'const needle = 1\nneedle again\n', 'utf8')
    fs.writeFileSync(path.join(root, 'src', 'ignored.js'), 'needle\n', 'utf8')
    fs.writeFileSync(path.join(root, 'node_modules', 'ignored.ts'), 'needle\n', 'utf8')
    fs.writeFileSync(path.join(root, '.git', 'ignored.ts'), 'needle\n', 'utf8')
    fs.writeFileSync(path.join(root, 'binary.ts'), Buffer.from([0, 1, 2, 3]))

    const result = await workspaceSearchTool({
      query: 'needle',
      include: '**/*.ts',
      maxResults: 10,
    }, context(root))

    expect(result.results).toHaveLength(2)
    expect(result.results[0]).toMatchObject({
      relativePath: 'src/app.ts',
      line: 1,
      column: 7,
      preview: 'const needle = 1',
      ranges: [{ start: 6, end: 12 }],
    })
    expect(result.results[1]).toMatchObject({ relativePath: 'src/app.ts', line: 2 })
    expect(result.scannedFiles).toBeGreaterThanOrEqual(1)
    expect(result.results.some((item: any) => item.relativePath.includes('node_modules'))).toBe(false)
  })

  it('supports deterministic cursor pagination and file enumeration mode', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-workspace-search-'))
    tempDirectories.push(root)
    fs.mkdirSync(path.join(root, 'src'))
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'a', 'utf8')
    fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'b', 'utf8')

    const first = await workspaceSearchTool({
      mode: 'files',
      query: '**/*.ts',
      maxResults: 1,
    }, context(root))
    const second = await workspaceSearchTool({
      mode: 'files',
      query: '**/*.ts',
      maxResults: 1,
      cursor: first.nextCursor,
    }, context(root))

    expect(first.results).toHaveLength(1)
    expect(first.nextCursor).toBeTruthy()
    expect(second.results).toHaveLength(1)
    expect(second.results[0].relativePath).not.toBe(first.results[0].relativePath)
    expect(second.nextCursor).toBeUndefined()
  })

  it('stops on resource limits and propagates cancellation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-workspace-search-'))
    tempDirectories.push(root)
    fs.writeFileSync(path.join(root, 'large.txt'), 'x'.repeat(2_100_000), 'utf8')

    const result = await workspaceSearchTool({
      query: 'x',
      maxResults: 10,
    }, context(root))
    expect(result.resourceLimited).toBe(true)

    const controller = new AbortController()
    controller.abort(new Error('stop'))
    await expect(workspaceSearchTool({ query: 'x' }, {
      ...context(root),
      signal: controller.signal,
    })).rejects.toThrow('stop')
  })
})
