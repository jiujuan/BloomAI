import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolvePathWithinAllowedRoots } from './path-policy'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('PathPolicy', () => {
  it('resolves a readable file inside an approved root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-path-policy-'))
    tempDirectories.push(root)
    const file = path.join(root, 'notes.txt')
    fs.writeFileSync(file, 'hello', 'utf8')

    await expect(resolvePathWithinAllowedRoots('notes.txt', {
      allowedRoots: [root],
      access: 'read',
    })).resolves.toBe(fs.realpathSync(file))
  })

  it('rejects parent traversal and root-prefix lookalikes', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-path-policy-'))
    const root = path.join(parent, 'app')
    const sibling = path.join(parent, 'app-copy')
    fs.mkdirSync(root)
    fs.mkdirSync(sibling)
    fs.writeFileSync(path.join(parent, 'secret.txt'), 'secret', 'utf8')
    tempDirectories.push(parent)

    await expect(resolvePathWithinAllowedRoots('../secret.txt', {
      allowedRoots: [root],
      access: 'read',
    })).rejects.toThrow('outside approved roots')

    await expect(resolvePathWithinAllowedRoots(sibling, {
      allowedRoots: [root],
      access: 'read',
    })).rejects.toThrow('outside approved roots')
  })

  it('rejects a symlink whose target escapes the approved root', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-path-policy-'))
    const root = path.join(parent, 'root')
    const outside = path.join(parent, 'outside')
    fs.mkdirSync(root)
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret', 'utf8')
    const link = path.join(root, 'linked')
    try {
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      return
    }
    tempDirectories.push(parent)

    await expect(resolvePathWithinAllowedRoots(path.join('linked', 'secret.txt'), {
      allowedRoots: [root],
      access: 'read',
    })).rejects.toThrow('outside approved roots')
  })

  it('allows a new file only when its existing parent is approved', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-path-policy-'))
    const parent = path.join(root, 'new', 'nested')
    fs.mkdirSync(parent, { recursive: true })
    tempDirectories.push(root)

    await expect(resolvePathWithinAllowedRoots(path.join('new', 'nested', 'out.txt'), {
      allowedRoots: [root],
      access: 'write',
      createParents: true,
    })).resolves.toBe(path.join(root, 'new', 'nested', 'out.txt'))
  })
})
