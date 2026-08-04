import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fsStatTool } from './fs-stat'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('fs_stat', () => {
  it('returns bounded metadata for files and directories', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-fs-stat-'))
    tempDirectories.push(root)
    const filePath = path.join(root, 'notes.md')
    fs.writeFileSync(filePath, '# notes', 'utf8')

    const file = await fsStatTool({ path: 'notes.md' }, { toolId: 'fs_stat', allowedRoots: [root] })
    const directory = await fsStatTool({ path: '.' }, { toolId: 'fs_stat', allowedRoots: [root] })

    expect(file).toMatchObject({
      path: fs.realpathSync(filePath),
      type: 'file',
      size: 7,
      extension: '.md',
      isBinary: false,
    })
    expect(file.modifiedAt).toEqual(expect.any(String))
    expect(directory).toMatchObject({ type: 'directory', size: 0 })
  })

  it('reports symlinks without allowing an escape from the approved root', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-fs-stat-'))
    const root = path.join(parent, 'root')
    const outside = path.join(parent, 'outside')
    fs.mkdirSync(root)
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret', 'utf8')
    tempDirectories.push(parent)

    const link = path.join(root, 'inside-link')
    try {
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      return
    }

    await expect(fsStatTool({ path: 'inside-link' }, { toolId: 'fs_stat', allowedRoots: [root] }))
      .rejects.toThrow(/outside approved roots/i)
  })

  it('rejects paths outside approved roots', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-fs-stat-'))
    const outside = path.join(path.dirname(root), 'outside.txt')
    fs.writeFileSync(outside, 'secret', 'utf8')
    tempDirectories.push(root)
    tempDirectories.push(outside)

    await expect(fsStatTool({ path: outside }, { toolId: 'fs_stat', allowedRoots: [root] }))
      .rejects.toThrow(/outside approved roots/i)
  })
})
