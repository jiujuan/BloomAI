import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fsEditTool } from './fs-edit'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('fs_edit', () => {
  it('rejects an expected hash conflict without changing the file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-fs-edit-'))
    tempDirectories.push(root)
    const filePath = path.join(root, 'app.ts')
    const original = 'const value = 1\n'
    fs.writeFileSync(filePath, original, 'utf8')

    const expectedHash = createHash('sha256').update('stale').digest('hex')

    await expect(fsEditTool({
      path: filePath,
      oldText: 'const value = 1',
      newText: 'const value = 2',
      expectedHash,
    }, { toolId: 'fs_edit', allowedRoots: [root] })).rejects.toThrow(/expectedHash/)

    expect(fs.readFileSync(filePath, 'utf8')).toBe(original)
  })
})
