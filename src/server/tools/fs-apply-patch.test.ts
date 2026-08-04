import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fsApplyPatchTool, rollbackFsApplyPatch } from './fs-apply-patch'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function context(root: string) {
  return { toolId: 'fs_apply_patch', allowedRoots: [root] as const }
}

describe('fs_apply_patch', () => {
  it('previews a patch without writing by default', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-fs-apply-patch-'))
    tempDirectories.push(root)
    const filePath = path.join(root, 'app.ts')
    fs.writeFileSync(filePath, 'const a = 1\nconst b = 2\n', 'utf8')

    const result = await fsApplyPatchTool({
      patch: [
        '--- a/app.ts',
        '+++ b/app.ts',
        '@@ -1,2 +1,2 @@',
        ' const a = 1',
        '-const b = 2',
        '+const b = 3',
      ].join('\n'),
    }, context(root))

    expect(result).toMatchObject({
      dryRun: true,
      applied: false,
      conflicts: [],
      modifiedFiles: [],
      files: [{
        relativePath: 'app.ts',
        status: 'modified',
        hunks: 1,
        additions: 1,
        deletions: 1,
      }],
    })
    expect(fs.readFileSync(filePath, 'utf8')).toBe('const a = 1\nconst b = 2\n')
  })

  it('applies changes atomically, creates a backup, and rolls back safely', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-fs-apply-patch-'))
    tempDirectories.push(root)
    const filePath = path.join(root, 'app.ts')
    const original = 'const value = 1\n'
    fs.writeFileSync(filePath, original, 'utf8')

    const result = await fsApplyPatchTool({
      patch: [
        '--- a/app.ts',
        '+++ b/app.ts',
        '@@ -1,1 +1,1 @@',
        '-const value = 1',
        '+const value = 2',
      ].join('\n'),
      dryRun: false,
    }, context(root))

    expect(result.applied).toBe(true)
    expect(result.rollbackToken).toEqual(expect.any(String))
    expect(result.backupPaths).toEqual([expect.stringContaining('bloomai-backup')])
    expect(fs.readFileSync(filePath, 'utf8')).toBe('const value = 2\n')

    fs.writeFileSync(filePath, 'changed after patch\n', 'utf8')
    await expect(rollbackFsApplyPatch(result.rollbackToken!, context(root))).rejects.toThrow(/Rollback conflict/)
    fs.writeFileSync(filePath, 'const value = 2\n', 'utf8')
    await expect(rollbackFsApplyPatch(result.rollbackToken!, context(root))).resolves.toMatchObject({
      restoredFiles: [filePath],
    })
    expect(fs.readFileSync(filePath, 'utf8')).toBe(original)
  })

  it('reports a conflict and never partially applies a multi-file patch', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-fs-apply-patch-'))
    tempDirectories.push(root)
    const firstPath = path.join(root, 'first.txt')
    const secondPath = path.join(root, 'second.txt')
    fs.writeFileSync(firstPath, 'first: old\n', 'utf8')
    fs.writeFileSync(secondPath, 'second: current\n', 'utf8')

    const result = await fsApplyPatchTool({
      patch: [
        '--- a/first.txt',
        '+++ b/first.txt',
        '@@ -1,1 +1,1 @@',
        '-first: old',
        '+first: new',
        '--- a/second.txt',
        '+++ b/second.txt',
        '@@ -1,1 +1,1 @@',
        '-second: stale',
        '+second: new',
      ].join('\n'),
      dryRun: false,
    }, context(root))

    expect(result.applied).toBe(false)
    expect(result.conflicts).toEqual([{
      path: 'second.txt',
      reason: expect.stringContaining('expected'),
    }])
    expect(fs.readFileSync(firstPath, 'utf8')).toBe('first: old\n')
    expect(fs.readFileSync(secondPath, 'utf8')).toBe('second: current\n')
  })

  it('rejects absolute and traversal paths before touching files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-fs-apply-patch-'))
    tempDirectories.push(root)

    await expect(fsApplyPatchTool({
      patch: [
        '--- a/../secret.txt',
        '+++ b/../secret.txt',
        '@@ -0,0 +1,1 @@',
        '+secret',
      ].join('\n'),
    }, context(root))).rejects.toThrow(/escape|relative/i)

    await expect(fsApplyPatchTool({
      patch: [
        '--- /tmp/secret.txt',
        '+++ /tmp/secret.txt',
        '@@ -0,0 +1,1 @@',
        '+secret',
      ].join('\n'),
    }, context(root))).rejects.toThrow(/relative|path/i)
  })

  it('supports creating and deleting files without leaving a partial result', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-fs-apply-patch-'))
    tempDirectories.push(root)
    const createdPath = path.join(root, 'new.txt')
    const deletedPath = path.join(root, 'old.txt')
    fs.writeFileSync(deletedPath, 'remove me\n', 'utf8')

    const result = await fsApplyPatchTool({
      patch: [
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1,1 @@',
        '+created',
        '--- a/old.txt',
        '+++ /dev/null',
        '@@ -1,1 +0,0 @@',
        '-remove me',
      ].join('\n'),
      dryRun: false,
      createBackup: true,
    }, context(root))

    expect(result.applied).toBe(true)
    expect(result.rollbackToken).toEqual(expect.any(String))
    expect(fs.readFileSync(createdPath, 'utf8')).toBe('created\n')
    expect(fs.existsSync(deletedPath)).toBe(false)

    await expect(rollbackFsApplyPatch(result.rollbackToken!, context(root))).resolves.toMatchObject({
      restoredFiles: [createdPath, deletedPath],
    })
    expect(fs.existsSync(createdPath)).toBe(false)
    expect(fs.readFileSync(deletedPath, 'utf8')).toBe('remove me\n')
  })

  it('rejects duplicate target sections without applying either section', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-fs-apply-patch-'))
    tempDirectories.push(root)
    const filePath = path.join(root, 'same.txt')
    fs.writeFileSync(filePath, 'before\n', 'utf8')

    const result = await fsApplyPatchTool({
      patch: [
        '--- a/same.txt',
        '+++ b/same.txt',
        '@@ -1,1 +1,1 @@',
        '-before',
        '+first',
        '--- a/same.txt',
        '+++ b/same.txt',
        '@@ -1,1 +1,1 @@',
        '-before',
        '+second',
      ].join('\n'),
      dryRun: false,
    }, context(root))

    expect(result.applied).toBe(false)
    expect(result.conflicts).toEqual([{
      path: 'same.txt',
      reason: 'Patch contains multiple file sections for the same target',
    }])
    expect(fs.readFileSync(filePath, 'utf8')).toBe('before\n')
  })
})
