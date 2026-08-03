import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'

const originalDataDir = process.env.DATA_DIR

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = originalDataDir
})

describe('getWorkspacesDir', () => {
  it('resolves a configured DATA_DIR without creating it', async () => {
    const dataDir = path.join(os.tmpdir(), `bloomai-workspaces-${Date.now()}`)
    process.env.DATA_DIR = dataDir
    const { getWorkspacesDir } = await import('./paths')

    expect(getWorkspacesDir()).toBe(path.join(dataDir, 'workspaces'))
    expect(fs.existsSync(dataDir)).toBe(false)
  })

  it('uses the default data directory when DATA_DIR is unset', async () => {
    delete process.env.DATA_DIR
    const { getDataDir, getWorkspacesDir } = await import('./paths')
    expect(getWorkspacesDir()).toBe(path.join(getDataDir(), 'workspaces'))
  })
})
