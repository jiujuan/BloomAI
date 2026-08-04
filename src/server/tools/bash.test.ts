import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bashTool } from './bash'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('bash', () => {
  it('rejects destructive commands instead of passing them to a shell', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-bash-'))
    tempDirectories.push(root)

    await expect(bashTool({
      command: 'rm',
      args: ['-rf', root],
    }, { toolId: 'bash', allowedRoots: [root] })).rejects.toThrow(/not allowed/)
  })

  it('rejects a working directory outside the approved roots', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-bash-'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-bash-outside-'))
    tempDirectories.push(root, outside)

    await expect(bashTool({
      command: 'pwd',
      cwd: outside,
    }, { toolId: 'bash', allowedRoots: [root] })).rejects.toThrow(/outside approved roots|Path policy denied/)
  })
})
