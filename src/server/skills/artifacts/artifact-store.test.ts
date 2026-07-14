import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function createRunFixture() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../../db/client')
  await client.runMigrations()
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const { getSkillRunArtifactsDir } = await import('../../db/paths')
  const version = skillPackageRepo.createVersion({
    packageId: skillPackageRepo.createPackage({ name: 'Artifact fixture', description: '', sourceType: 'local-directory' }).id,
    version: '1.0.0', manifest: {}, manifestHash: 'artifact-fixture', packagePath: '/packages/artifact-fixture',
  })
  const run = skillPackageRepo.createRun({ skillVersionId: version.id, status: 'created', input: {}, context: {} })
  return { getSkillRunArtifactsDir, run, skillPackageRepo }
}

describe('ArtifactStore', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-artifacts-'))
    originalEnv = { ...process.env }
    process.env.DATA_DIR = dataDir
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('derives an isolated run directory from DATA_DIR and lists stored artifact metadata', async () => {
    const { getSkillRunArtifactsDir, run, skillPackageRepo } = await createRunFixture()
    const { ArtifactStore } = await import('./artifact-store')
    const store = new ArtifactStore()

    const artifact = store.writeText({ runId: run.id, kind: 'markdown', fileName: 'summary.md', content: '# Result' })

    expect(getSkillRunArtifactsDir(run.id)).toBe(path.join(dataDir, 'skills', 'runs', run.id, 'artifacts'))
    expect(artifact).toMatchObject({ kind: 'markdown', path: 'summary.md', mime_type: 'text/markdown', size_bytes: 8 })
    expect(skillPackageRepo.getArtifact(artifact.id)?.path).toBe('summary.md')
    expect(skillPackageRepo.listArtifacts(run.id)).toHaveLength(1)
  })

  it('writes supported artifact kinds and reads their bytes by artifact id', async () => {
    const { getSkillRunArtifactsDir, run } = await createRunFixture()
    const { ArtifactStore } = await import('./artifact-store')
    const store = new ArtifactStore()
    const markdown = store.writeText({ runId: run.id, kind: 'markdown', fileName: 'summary.md', content: '# Result' })
    const json = store.writeText({ runId: run.id, kind: 'json', fileName: 'result.json', content: '{"ok":true}' })
    const prompt = store.writeText({ runId: run.id, kind: 'prompt', fileName: 'scene.txt', content: 'Editorial skyline' })
    const image = store.writeImageReference({ runId: run.id, fileName: 'hero.json', reference: { generationId: 'image-1' } })
    const manifest = store.writeText({ runId: run.id, kind: 'directory-manifest', fileName: 'files.json', content: '{"files":[]}' })

    expect([markdown, json, prompt, image, manifest].map((artifact) => artifact.mime_type)).toEqual([
      'text/markdown', 'application/json', 'text/plain', 'application/vnd.bloomai.image-reference+json', 'application/vnd.bloomai.directory-manifest+json',
    ])
    expect(store.readContent(markdown.id)).toEqual({ mimeType: 'text/markdown', content: Buffer.from('# Result') })
    expect(fs.readFileSync(path.join(getSkillRunArtifactsDir(run.id), 'hero.json'), 'utf8')).toContain('image-1')
  })

  it('rejects unsafe names, invalid kind extensions, symlinks, and tampered artifact files', async () => {
    const { getSkillRunArtifactsDir, run } = await createRunFixture()
    const { ArtifactStore, ArtifactStoreError } = await import('./artifact-store')
    const store = new ArtifactStore()

    expect(() => store.writeText({ runId: run.id, kind: 'markdown', fileName: '../outside.md', content: 'x' })).toThrow(ArtifactStoreError)
    expect(() => store.writeText({ runId: run.id, kind: 'markdown', fileName: 'wrong.json', content: 'x' })).toThrow(ArtifactStoreError)
    const artifact = store.writeText({ runId: run.id, kind: 'markdown', fileName: 'summary.md', content: '# Result' })
    fs.writeFileSync(path.join(getSkillRunArtifactsDir(run.id), 'summary.md'), 'tampered')
    expect(() => store.readContent(artifact.id)).toThrow(/hash/i)

    const linked = store.writeText({ runId: run.id, kind: 'markdown', fileName: 'linked.md', content: '# Linked' })
    const linkedPath = path.join(getSkillRunArtifactsDir(run.id), 'linked.md')
    const outside = path.join(dataDir, 'outside.md')
    fs.writeFileSync(outside, '# Outside')
    fs.rmSync(linkedPath)
    try {
      fs.symlinkSync(outside, linkedPath, 'file')
    } catch (error: any) {
      if (error?.code === 'EPERM') return
      throw error
    }
    expect(() => store.readContent(linked.id)).toThrow(/regular/i)
  })

  it('exports an artifact only to an existing destination and retains files when a run is removed', async () => {
    const { getSkillRunArtifactsDir, run } = await createRunFixture()
    const { ArtifactStore, ArtifactStoreError } = await import('./artifact-store')
    const store = new ArtifactStore()
    const artifact = store.writeText({ runId: run.id, kind: 'markdown', fileName: 'summary.md', content: '# Result' })
    const destinationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-artifact-export-'))

    const exported = store.exportArtifact({ artifactId: artifact.id, destinationDir })
    expect(exported).toBe(path.join(destinationDir, 'summary.md'))
    expect(fs.readFileSync(exported, 'utf8')).toBe('# Result')
    expect(() => store.exportArtifact({ artifactId: artifact.id, destinationDir })).toThrow(ArtifactStoreError)
    expect(() => store.exportArtifact({ artifactId: artifact.id, destinationDir: path.join(destinationDir, 'missing') })).toThrow(ArtifactStoreError)

    store.removeRun(run.id)
    expect(fs.existsSync(getSkillRunArtifactsDir(run.id))).toBe(true)
    fs.rmSync(destinationDir, { recursive: true, force: true })
  })

  it('does not create artifact directories for unknown or unsafe run ids', async () => {
    await createRunFixture()
    const { ArtifactStore, ArtifactStoreError } = await import('./artifact-store')
    const store = new ArtifactStore()

    expect(() => store.writeText({ runId: 'missing-run', kind: 'markdown', fileName: 'summary.md', content: '# Result' })).toThrow(ArtifactStoreError)
    expect(() => store.writeText({ runId: '../escape', kind: 'markdown', fileName: 'summary.md', content: '# Result' })).toThrow(ArtifactStoreError)
    expect(fs.existsSync(path.join(dataDir, 'skills', 'runs', 'missing-run'))).toBe(false)
  })
})
