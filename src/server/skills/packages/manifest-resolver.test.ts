import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { ManifestResolutionError, canonicalManifestHash, resolveManifest, resolveSkillManifest, validateManifest } from './manifest-resolver'

const temporaryDirectories: string[] = []

function createPackage(files: Record<string, string>): string {
  const packagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-manifest-'))
  temporaryDirectories.push(packagePath)
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(packagePath, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return packagePath
}

afterEach(() => {
  while (temporaryDirectories.length) fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })

})

describe('resolveSkillManifest', () => {
  it('resolves supported frontmatter, package resources, capabilities, surface, and artifact outputs', () => {
    const packagePath = createPackage({
      'SKILL.md': `---
name: Article Illustrator
description: Illustrate a supplied article
runtime: instruction-agent
capabilities:
  - document.read_uploaded
  - image.generate
recommended_surface: image-studio
output_artifacts:
  - markdown
  - image-reference
future_field: retained
---
Create a visual plan first.
`,
      'references/brand.md': '# Brand\n',
      'assets/logo.png': 'image bytes',
    })

    const manifest = resolveSkillManifest(packagePath)

    expect(manifest).toMatchObject({
      name: 'Article Illustrator',
      description: 'Illustrate a supplied article',
      runtime: 'instruction-agent',
      entryPath: 'SKILL.md',
      compatible: true,
      requestedCapabilities: [
        { capability: 'document.read_uploaded', scope: {} },
        { capability: 'image.generate', scope: {} },
      ],
      recommendedSurface: 'image-studio',
      outputArtifactTypes: ['markdown', 'image-reference'],
      references: ['references/brand.md'],
      assets: ['assets/logo.png'],
      unsupported: [],
      unknownFrontmatter: { future_field: 'retained' },
    })
  })

  it('derives capability scope from nested frontmatter declarations', () => {
    const packagePath = createPackage({
      'SKILL.md': `---
capabilities:
  image.generate:
    maxCalls: 6
    allowedModels: [agnes-image-2.1-flash]
  web.fetch:
    allowedDomains:
      - example.com
---
Generate safely.
`,
    })

    expect(resolveSkillManifest(packagePath).requestedCapabilities).toEqual([
      { capability: 'image.generate', scope: { maxCalls: 6, allowedModels: ['agnes-image-2.1-flash'] } },
      { capability: 'web.fetch', scope: { allowedDomains: ['example.com'] } },
    ])
  })

  it('supports SKILL.md files without frontmatter using compatibility defaults', () => {
    const packagePath = createPackage({ 'SKILL.md': '# Simple Skill\nDo the task.\n' })

    expect(resolveSkillManifest(packagePath)).toMatchObject({
      name: 'Simple Skill',
      description: '',
      runtime: 'instruction-agent',
      compatible: true,
      requestedCapabilities: [],
      references: [],
      assets: [],
    })
  })

  it('marks unsupported declarations and scripts as incompatible without executing them', () => {
    const packagePath = createPackage({
      'SKILL.md': `---
runtime: python
capabilities: [shell.execute, web.search]
install_dependencies: true
mcp-plugin: local-tool
---
Never execute this.
`,
      'scripts/setup.py': 'raise RuntimeError("must not run")',
    })

    expect(resolveSkillManifest(packagePath)).toMatchObject({
      runtime: 'instruction-agent',
      compatible: false,
      requestedCapabilities: [{ capability: 'web.search', scope: {} }],
      unsupported: expect.arrayContaining([
        'runtime:python',
        'capability:shell.execute',
        'install_dependencies',
        'mcp-plugin',
        'scripts/',
      ]),
      scripts: ['scripts/setup.py'],
    })
  })

  it('rejects malformed frontmatter and entry paths outside the package root', () => {
    const malformed = createPackage({ 'SKILL.md': '---\nname: [unterminated\n---\nText' })
    const valid = createPackage({ 'SKILL.md': '# Valid\n' })

    expect(() => resolveSkillManifest(malformed)).toThrow(ManifestResolutionError)
    expect(() => resolveSkillManifest(valid, '../SKILL.md')).toThrow(ManifestResolutionError)
  })

  it('resolves explicit manifest.json, exposes diagnostics, and keeps the canonical hash stable', () => {
    const packagePath = createPackage({
      'SKILL.md': `---
name: Legacy Name
capabilities: [web.search]
---
# Canonical Heading
`,
      'manifest.json': JSON.stringify({
        name: 'Canonical Skill',
        slug: 'canonical-skill',
        version: '1.2.3',
        description: 'Canonical description',
        entry: 'SKILL.md',
        capabilities: [{ capability: 'web.search', scope: {} }],
        compatibility: { platform: ['win32'] },
        unsupported: ['runtime:python'],
      }),
      'references/notes.md': 'notes',
    })
    const reader = new (class {
      listFiles() { return ['references/notes.md', 'manifest.json', 'SKILL.md'] }
      readText(file: string) { return { content: fs.readFileSync(path.join(packagePath, file), 'utf8') } }
    })()
    const first = resolveManifest(reader)
    const second = resolveManifest({
      listFiles: () => ['SKILL.md', 'manifest.json', 'references/notes.md'],
      readText: (file: string) => ({ content: fs.readFileSync(path.join(packagePath, file), 'utf8') }),
    })

    expect(first.manifest).toMatchObject({ name: 'Canonical Skill', slug: 'canonical-skill', version: '1.2.3', entryPath: 'SKILL.md' })
    expect(first.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UNSUPPORTED_DECLARATION' })]))
    expect(first.canonicalHash).toBe(second.canonicalHash)
    expect(first.canonicalHash).toBe(canonicalManifestHash(first.manifest))
  })

  it('rejects duplicate frontmatter keys and executable entry declarations', () => {
    const duplicate = createPackage({ 'SKILL.md': '---\nname: first\nname: second\n---\nBody' })
    expect(() => resolveSkillManifest(duplicate)).toThrow(/Duplicate frontmatter field/)

    const executable = createPackage({
      'SKILL.md': '---\nentry: scripts/run.js\n---\nBody',
      'scripts/run.js': 'console.log("do not execute")',
    })
    const result = resolveSkillManifest(executable)
    expect(result.compatible).toBe(false)
    expect(result.unsupported).toContain('entry:not_allowed:scripts/run.js')
  })

  it('validates canonical manifests with structured diagnostics', () => {
    const result = validateManifest({
      schemaVersion: 1,
      name: '',
      slug: 'bad slug',
      version: '1.0.0',
      description: '',
      entryPath: '../SKILL.md',
      runtime: 'instruction-agent',
      capabilities: [],
      files: [],
      compatibility: {},
      unsupported: [],
      extensions: {},
    })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
