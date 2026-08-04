import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fsApplyPatchTool } from './fs-apply-patch'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

const patch = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,2 @@
-const value = 1
+const value = 2
 console.log(value)
`

function context(root: string) {
  return { toolId: 'fs_apply_patch', allowedRoots: [root] as const }
}

describe('fs_apply_patch', () => {
  it('defaults to a dry run and returns a preview without writing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-apply-patch-'))
    tempDirectories.push(root)
    fs.mkdirSync(path.join(root, 'src'))
    const filePath = path.join(root, 'src', 'app.ts')
    fs.writeFileSync(filePath, 'const value = 1\nconsole.log(value)\n', 'utf8')

    const result = await fsApplyPatchTool({ patch }, context(root))

    expect(result).toMatchObject({
      dryRun: true,
      applied: false,
      files: [{ relativePath: 'src/app.ts', hunks: 1, linesAdded: 1, linesRemoved: 1 }],
      conflicts: [],
    })
    expect(fs.readFileSync(filePath, 'utf8')).toBe('const value = 1\nconsole.log(value)\n')
  })

  it('writes all files atomically, creates a backup, and returns a rollback token', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-apply-patch-'))
    tempDirectories.push(root)
    fs.mkdirSync(path.join(root, 'src'))
    const filePath = path.join(root, 'src', 'app.ts')
    fs.writeFileSync(filePath, 'const value = 1\nconsole.log(value)\n', 'utf8')

    const result = await fsApplyPatchTool({ patch, dryRun: false }, context(root))

    expect(result).toMatchObject({
      dryRun: false,
      applied: true,
      files: [{
        relativePath: 'src/app.ts',
        backupPath: expect.stringContaining('.bak-'),
        rollbackToken: expect.any(String),
      }],
      conflicts: [],
    })
    expect(fs.readFileSync(filePath, 'utf8')).toContain('const value = 2')
    expect(result.files[0].backupPath).toBeDefined()
    expect(fs.existsSync(result.files[0].backupPath!)).toBe(true)
  })

  it('reports expected-hash conflicts without partially changing files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-apply-patch-'))
    tempDirectories.push(root)
    fs.mkdirSync(path.join(root, 'src'))
    const filePath = path.join(root, 'src', 'app.ts')
    fs.writeFileSync(filePath, 'const value = 1\nconsole.log(value)\n', 'utf8')
    const expectedHash = createHash('sha256').update('different').digest('hex')

    const result = await fsApplyPatchTool({
      patch,
      dryRun: false,
      expectedHashes: { 'src/app.ts': expectedHash },
    }, context(root))

    expect(result.applied).toBe(false)
    expect(result.conflicts).toEqual([expect.objectContaining({ relativePath: 'src/app.ts', reason: 'expected_hash_mismatch' })])
    expect(fs.readFileSync(filePath, 'utf8')).toContain('const value = 1')
  })

  it('rejects absolute and parent-traversal patch filenames', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-apply-patch-'))
    tempDirectories.push(root)

    await expect(fsApplyPatchTool({
      patch: `--- a/../secret.txt\n+++ b/../secret.txt\n@@ -0,0 +1 @@\n+secret\n`,
    }, context(root))).rejects.toThrow(/relative|outside|path/i)
  })

  it('reports a conflict when a planned file changes before the atomic write', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-apply-patch-'))
    tempDirectories.push(root)
    const filePath = path.join(root, 'src.ts')
    const originalContent = 'const value = 1\n'
    fs.writeFileSync(filePath, originalContent, 'utf8')

    const originalReadFile = fs.promises.readFile
    let readCount = 0
    const readFileSpy = vi.spyOn(fs.promises, 'readFile') as any
    readFileSpy.mockImplementation(async (...args: any[]) => {
      const content = await (originalReadFile as any)(...args)
      readCount += 1
      if (readCount === 1) fs.writeFileSync(filePath, 'const value = 9\n', 'utf8')
      return content
    })

    const result = await fsApplyPatchTool({
      patch: `--- a/src.ts
+++ b/src.ts
@@ -1,1 +1,1 @@
-const value = 1
+const value = 2
`,
      dryRun: false,
    }, context(root))

    expect(result.applied).toBe(false)
    expect(result.conflicts).toEqual([
      expect.objectContaining({ relativePath: 'src.ts', reason: 'file_changed_since_plan' }),
    ])
    expect(fs.readFileSync(filePath, 'utf8')).toBe('const value = 9\n')
    expect(readCount).toBeGreaterThanOrEqual(2)
  })
})
