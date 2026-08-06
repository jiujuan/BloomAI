import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { PackagePathPolicyError, assertArchiveEntryPath, isAllowedSnapshotPath, normalizeSafeRelativePath } from './package-path-policy'
import { SkillPackageReadError, SkillPackageReader } from './package-reader'

const roots: string[] = []
function packageRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-reader-budget-'))
  roots.push(root)
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return root
}
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }) })

describe('package path policy', () => {
  it('rejects traversal, absolute, NUL, depth, and long paths with stable codes', () => {
    for (const value of ['../secret', '/etc/passwd', 'C:/secret', 'a/\0b', 'a//b']) {
      expect(() => normalizeSafeRelativePath(value)).toThrow(PackagePathPolicyError)
    }
    expect(() => normalizeSafeRelativePath('a/b/c', { maxFileCount: 10, maxFileBytes: 10, maxUnpackedBytes: 10, maxArchiveBytes: 10, maxPathLength: 240, maxDepth: 2 })).toThrow(/depth/)
    expect(assertArchiveEntryPath('references/notes.md')).toBe('references/notes.md')
  })

  it('only allows documented package snapshot areas and safe file types', () => {
    expect(isAllowedSnapshotPath('SKILL.md')).toBe(true)
    expect(isAllowedSnapshotPath('references/guide.md')).toBe(true)
    expect(isAllowedSnapshotPath('assets/hero.png')).toBe(true)
    expect(isAllowedSnapshotPath('scripts/run.js')).toBe(false)
    expect(isAllowedSnapshotPath('assets/secret.exe')).toBe(false)
  })
})

describe('bounded package reader', () => {
  it('enforces aggregate file and byte budgets and exposes a stable fingerprint', () => {
    const root = packageRoot({ 'SKILL.md': '# Skill\n', 'references/a.md': '12345', 'references/b.md': '67890' })
    const reader = new SkillPackageReader(root, { maxFileCount: 3, maxUnpackedBytes: 16, maxFileBytes: 8, maxReadBytes: 8 })
    expect(() => reader.listFiles()).toThrow(SkillPackageReadError)

    const fingerprintReader = new SkillPackageReader(root, { maxFileCount: 10, maxUnpackedBytes: 100, maxFileBytes: 20, maxReadBytes: 20 })
    const fingerprint = fingerprintReader.getFingerprint()
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/)
    fingerprintReader.close()
    expect(() => fingerprintReader.listFiles()).toThrow(/closed/)
  })

  it('supports bounded readBuffer and manifest.json text reads without following links', () => {
    const root = packageRoot({ 'SKILL.md': '# Skill\n', 'manifest.json': '{}', 'assets/blob.bin': 'bytes' })
    const reader = new SkillPackageReader(root, { maxReadBytes: 16 })
    expect(reader.readText('manifest.json').content).toBe('{}')
    expect(reader.readBuffer('assets/blob.bin').content.toString()).toBe('bytes')
    expect(() => reader.readBuffer('../outside')).toThrow(SkillPackageReadError)
  })
})
