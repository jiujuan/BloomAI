import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { SkillPackageReadError, SkillPackageReader } from './package-reader'

const temporaryDirectories: string[] = []

function createPackage(files: Record<string, string | Buffer>): string {
  const packagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-package-reader-'))
  temporaryDirectories.push(packagePath)
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(packagePath, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return packagePath
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

afterEach(() => {
  while (temporaryDirectories.length) fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
})

describe('SkillPackageReader', () => {
  it('lists package files and reads the SKILL.md entry with digest metadata', () => {
    const skill = '# Article Illustrator\nRead me completely.\n'
    const packagePath = createPackage({
      'SKILL.md': skill,
      'references/style.md': '# Style\n',
      'assets/logo.txt': 'logo',
    })

    const reader = new SkillPackageReader(packagePath)

    expect(reader.listFiles()).toEqual(['SKILL.md', 'assets/logo.txt', 'references/style.md'])
    expect(reader.readEntry()).toEqual({
      path: 'SKILL.md',
      content: skill,
      sizeBytes: Buffer.byteLength(skill),
      sha256: sha256(skill),
    })
    expect(reader.loadedFiles()).toEqual([{ path: 'SKILL.md', sizeBytes: Buffer.byteLength(skill), sha256: sha256(skill) }])
  })

  it('loads references on demand and reads assets as immutable bytes', () => {
    const packagePath = createPackage({
      'SKILL.md': '# Skill\n',
      'references/style.md': '# Style\nUse concise prompts.\n',
      'assets/logo.bin': Buffer.from([1, 2, 3, 4]),
    })
    const reader = new SkillPackageReader(packagePath)

    expect(reader.readText('references/style.md')).toMatchObject({
      path: 'references/style.md',
      content: '# Style\nUse concise prompts.\n',
    })
    expect(reader.readAsset('assets/logo.bin')).toMatchObject({
      path: 'assets/logo.bin',
      content: Buffer.from([1, 2, 3, 4]),
      sha256: sha256(Buffer.from([1, 2, 3, 4])),
    })
    expect(reader.loadedFiles().map((file) => file.path)).toEqual(['references/style.md', 'assets/logo.bin'])
  })

  it('rejects paths outside the canonical package root', () => {
    const packagePath = createPackage({ 'SKILL.md': '# Skill\n' })
    const reader = new SkillPackageReader(packagePath)

    expect(() => reader.readText('../SKILL.md')).toThrow(SkillPackageReadError)
    expect(() => reader.readText('../../.env')).toThrow(SkillPackageReadError)
    expect(() => reader.readText('/etc/passwd')).toThrow(SkillPackageReadError)
    expect(() => reader.readText('C:/Users/xing/.env')).toThrow(SkillPackageReadError)
  })

  it('rejects symlink escapes when available and non-regular files', () => {
    const packagePath = createPackage({ 'SKILL.md': '# Skill\n' })
    const outside = path.join(os.tmpdir(), `bloomai-package-reader-outside-${Date.now()}.txt`)
    fs.writeFileSync(outside, 'outside')
    temporaryDirectories.push(outside)
    fs.mkdirSync(path.join(packagePath, 'references'), { recursive: true })
    let symlinkCreated = false
    try {
      fs.symlinkSync(outside, path.join(packagePath, 'references', 'outside.md'))
      symlinkCreated = true
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EPERM') throw error
    }
    fs.mkdirSync(path.join(packagePath, 'references', 'folder'), { recursive: true })

    const reader = new SkillPackageReader(packagePath)

    if (symlinkCreated) expect(() => reader.readText('references/outside.md')).toThrow(SkillPackageReadError)
    expect(() => reader.readText('references/folder')).toThrow(SkillPackageReadError)
  })

  it('enforces per-read byte and per-run file count limits', () => {
    const packagePath = createPackage({
      'SKILL.md': '# Skill\n',
      'references/a.md': '12345',
      'references/b.md': 'tiny',
    })

    expect(() => new SkillPackageReader(packagePath, { maxReadBytes: 4 }).readText('references/a.md')).toThrow(SkillPackageReadError)

    const reader = new SkillPackageReader(packagePath, { maxFilesPerRun: 1 })
    reader.readText('references/a.md')
    reader.readText('references/a.md')
    expect(() => reader.readText('references/b.md')).toThrow(SkillPackageReadError)
  })

  it('keeps asset reads inside assets and text reads inside textual package resources', () => {
    const packagePath = createPackage({
      'SKILL.md': '# Skill\n',
      'references/style.md': '# Style\n',
      'assets/logo.txt': 'asset',
    })
    const reader = new SkillPackageReader(packagePath)

    expect(() => reader.readAsset('references/style.md')).toThrow(SkillPackageReadError)
    expect(() => reader.readText('assets/logo.txt')).toThrow(SkillPackageReadError)
  })

  it('exposes package file operations as controlled loader capabilities', () => {
    const packagePath = createPackage({
      'SKILL.md': '# Skill\n',
      'references/style.md': '# Style\n',
      'assets/logo.bin': Buffer.from([9, 8, 7]),
    })
    const reader = new SkillPackageReader(packagePath)

    expect(reader.executeCapability({ capability: 'package.list_files', input: {} })).toEqual({
      files: ['SKILL.md', 'assets/logo.bin', 'references/style.md'],
    })
    expect(reader.executeCapability({ capability: 'package.read_text', input: { path: 'references/style.md' } })).toMatchObject({
      path: 'references/style.md',
      content: '# Style\n',
    })
    expect(reader.executeCapability({ capability: 'package.read_asset', input: { path: 'assets/logo.bin' } })).toMatchObject({
      path: 'assets/logo.bin',
      content: Buffer.from([9, 8, 7]),
    })
    expect(() => reader.executeCapability({ capability: 'package.read_text', input: {} })).toThrow(SkillPackageReadError)
    expect(() => reader.executeCapability({ capability: 'package.delete_file', input: { path: 'SKILL.md' } })).toThrow(SkillPackageReadError)
  })
})
