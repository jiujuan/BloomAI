import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSkillRuntimePorts } from '../application/test-doubles'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function createRunFixture() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../../db/client')
  await client.runMigrations()
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const { getSkillRuntimeConfig } = await import('../config/skill-runtime.config')
  const version = skillPackageRepo.createVersion({
    packageId: skillPackageRepo.createPackage({ name: 'Artifact fixture', description: '', sourceType: 'local-directory' }).id,
    version: '1.0.0', manifest: {}, manifestHash: 'artifact-fixture', packagePath: '/packages/artifact-fixture',
  })
  const run = skillPackageRepo.createRun({ skillVersionId: version.id, status: 'created', input: {}, context: {} })
  return { artifactRoot: getSkillRuntimeConfig().artifactRoot, exportRoot: getSkillRuntimeConfig().exportRoot, run, skillPackageRepo }
}

describe('ArtifactStore', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-artifacts-'))
    originalEnv = { ...process.env }
    process.env.DATA_DIR = dataDir
    process.env.SKILL_ARTIFACT_ROOT = path.join(dataDir, 'skills', 'runs')
    process.env.SKILL_EXPORT_ROOT = path.join(dataDir, 'skills', 'exports')
    fs.mkdirSync(process.env.SKILL_EXPORT_ROOT, { recursive: true })
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('derives an isolated run directory from DATA_DIR and lists stored artifact metadata', async () => {
    const { artifactRoot, run, skillPackageRepo } = await createRunFixture()
    const { ArtifactStore } = await import('./artifact-store')
    const store = new ArtifactStore()

    const artifact = store.writeText({ runId: run.id, kind: 'markdown', fileName: 'summary.md', content: '# Result' })

    expect(artifactRoot).toBe(path.join(dataDir, 'skills', 'runs'))
    expect(fs.existsSync(path.join(artifactRoot, run.id))).toBe(true)
    expect(artifact).toMatchObject({ kind: 'markdown', path: 'summary.md', mime_type: 'text/markdown', size_bytes: 8 })
    expect(skillPackageRepo.getArtifact(artifact.id)?.path).toBe('summary.md')
    expect(skillPackageRepo.listArtifacts(run.id)).toHaveLength(1)
  })

  it('writes supported artifact kinds and reads their bytes by artifact id', async () => {
    const { artifactRoot, run } = await createRunFixture()
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
    expect(store.readContent({ artifactId: markdown.id, runId: run.id })).toEqual({ mimeType: 'text/markdown', content: Buffer.from('# Result') })
    expect(fs.readFileSync(path.join(artifactRoot, run.id, 'hero.json'), 'utf8')).toContain('image-1')
  })

  it('rejects unsafe names, invalid kind extensions, symlinks, and tampered artifact files', async () => {
    const { artifactRoot, run } = await createRunFixture()
    const { ArtifactStore, ArtifactStoreError } = await import('./artifact-store')
    const store = new ArtifactStore()

    expect(() => store.writeText({ runId: run.id, kind: 'markdown', fileName: '../outside.md', content: 'x' })).toThrow(ArtifactStoreError)
    expect(() => store.writeText({ runId: run.id, kind: 'markdown', fileName: 'wrong.json', content: 'x' })).toThrow(ArtifactStoreError)
    const artifact = store.writeText({ runId: run.id, kind: 'markdown', fileName: 'summary.md', content: '# Result' })
    fs.writeFileSync(path.join(artifactRoot, run.id, 'summary.md'), 'tampered')
    expect(() => store.readContent({ artifactId: artifact.id, runId: run.id })).toThrow(/hash/i)

    const linked = store.writeText({ runId: run.id, kind: 'markdown', fileName: 'linked.md', content: '# Linked' })
    const linkedPath = path.join(artifactRoot, run.id, 'linked.md')
    const outside = path.join(dataDir, 'outside.md')
    fs.writeFileSync(outside, '# Outside')
    fs.rmSync(linkedPath)
    try {
      fs.symlinkSync(outside, linkedPath, 'file')
    } catch (error: any) {
      if (error?.code === 'EPERM') return
      throw error
    }
    expect(() => store.readContent({ artifactId: linked.id, runId: run.id })).toThrow(/regular/i)
  })

  it('sanitizes Markdown previews before returning list metadata', async () => {
    const { run } = await createRunFixture()
    const { ArtifactStore } = await import('./artifact-store')
    const store = new ArtifactStore()
    store.writeText({
      runId: run.id,
      kind: 'markdown',
      fileName: 'unsafe.md',
      content: '<a href=\"javascript:alert(1)\" onclick=\"steal()\">safe</a><script>alert(2)</script>',
    })

    const preview = store.listArtifacts({ runId: run.id }).data[0]?.summary.contentPreview ?? ''
    expect(preview).toContain('safe')
    expect(preview).not.toMatch(/script|onclick|javascript:/i)
  })

  it('exports an artifact only to an existing destination and retains files when a run is removed', async () => {
    const { artifactRoot, run } = await createRunFixture()
    const { ArtifactStore, ArtifactStoreError } = await import('./artifact-store')
    const store = new ArtifactStore()
    const artifact = store.writeText({ runId: run.id, kind: 'markdown', fileName: 'summary.md', content: '# Result' })
    const destinationDir = path.join((await import('../config/skill-runtime.config')).getSkillRuntimeConfig().exportRoot, 'default-test')
    fs.mkdirSync(destinationDir, { recursive: true })

    const exported = store.exportArtifact({ artifactId: artifact.id, runId: run.id, destinationDir, confirmed: true, actor: 'test-user', auditReason: 'test export' })
    expect(exported).toBe(path.join(destinationDir, 'summary.md'))
    expect(fs.readFileSync(exported, 'utf8')).toBe('# Result')
    expect(() => store.exportArtifact({ artifactId: artifact.id, runId: run.id, destinationDir, confirmed: true, actor: 'test-user', auditReason: 'duplicate export' })).toThrow(ArtifactStoreError)
    expect(() => store.exportArtifact({ artifactId: artifact.id, runId: run.id, destinationDir: path.join(destinationDir, 'missing'), confirmed: true, actor: 'test-user', auditReason: 'missing destination' })).toThrow(ArtifactStoreError)

    store.removeRun(run.id)
    expect(fs.existsSync(path.join(artifactRoot, run.id))).toBe(true)
    fs.rmSync(destinationDir, { recursive: true, force: true })
  })

  it('uses configured roots, sets retention metadata, and requires an audited export confirmation', async () => {
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-artifact-root-'))
    const exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-export-root-'))
    process.env.SKILL_ARTIFACT_ROOT = artifactRoot
    process.env.SKILL_EXPORT_ROOT = exportRoot
    const { run, skillPackageRepo } = await createRunFixture()
    const { ArtifactStore, ArtifactStoreError } = await import('./artifact-store')
    const store = new ArtifactStore()
    const artifact = store.writeText({ runId: run.id, kind: 'markdown', fileName: 'configured.md', content: '# Configured' })

    expect(artifact.retentionUntil).toBeTypeOf('number')
    expect(fs.existsSync(path.join(artifactRoot, run.id, 'configured.md'))).toBe(true)
    const destinationDir = path.join(exportRoot, 'user-selected')
    fs.mkdirSync(destinationDir)
    expect(() => store.exportArtifact({ artifactId: artifact.id, runId: run.id, destinationDir, auditReason: 'Keep generated report for review' })).toThrow(ArtifactStoreError)

    const exported = store.exportArtifact({
      artifactId: artifact.id,
      runId: run.id,
      destinationDir,
      confirmed: true,
      actor: 'user-1',
      auditReason: 'Keep generated report for review',
    })
    expect(fs.readFileSync(exported, 'utf8')).toBe('# Configured')
    expect(skillPackageRepo.getArtifact(artifact.id)).toMatchObject({ exported_by: 'user-1' })
  })

  it('rejects artifact reads and exports when the artifact id does not belong to the requested run', async () => {
    const { run, skillPackageRepo } = await createRunFixture()
    const { ArtifactStore, ArtifactStoreError } = await import('./artifact-store')
    const store = new ArtifactStore()
    const artifact = store.writeText({ runId: run.id, kind: 'markdown', fileName: 'summary.md', content: '# Result' })
    const version = skillPackageRepo.createVersion({
      packageId: skillPackageRepo.createPackage({ name: 'Other artifact fixture', description: '', sourceType: 'local-directory' }).id,
      version: '1.0.0', manifest: {}, manifestHash: 'other-artifact-fixture', packagePath: '/packages/other-artifact-fixture',
    })
    const otherRun = skillPackageRepo.createRun({ skillVersionId: version.id, status: 'created', input: {}, context: {} })
    const destinationDir = path.join((await import('../config/skill-runtime.config')).getSkillRuntimeConfig().exportRoot, 'ownership-test')
    fs.mkdirSync(destinationDir, { recursive: true })

    expect(() => store.readContent({ artifactId: artifact.id, runId: otherRun.id })).toThrow(ArtifactStoreError)
    expect(() => store.exportArtifact({ artifactId: artifact.id, runId: otherRun.id, destinationDir, confirmed: true, actor: 'test-user', auditReason: 'ownership test' })).toThrow(ArtifactStoreError)

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
  it('emits best-effort artifact create/export metrics with run and artifact correlation only', async () => {
    const ports = createFakeSkillRuntimePorts({ now: 10 })
    const version = ports.packages.createVersion({ packageId: 'pkg-1', version: '1.0.0', manifest: {}, manifestHash: 'hash', packagePath: '/pkg' })
    const run = ports.runs.createRun({ skillVersionId: version.id, status: 'created', input: {}, context: {} })
    const recordArtifact = vi.fn()
    const metrics = { recordArtifact }
    const { ArtifactStore } = await import('./artifact-store')
    const store = new ArtifactStore({ ...ports, metrics })
    const artifact = store.writeText({ runId: run.id, kind: 'markdown', fileName: 'observed.md', content: '# observed' })

    expect(recordArtifact).toHaveBeenCalledWith(expect.objectContaining({
      bytes: artifact.size_bytes,
      operation: 'create',
      outcome: 'success',
      correlation: expect.objectContaining({ runId: run.id, artifactId: artifact.id }),
    }))
    expect(JSON.stringify(recordArtifact.mock.calls)).not.toContain(dataDir)
    expect(JSON.stringify(recordArtifact.mock.calls)).not.toContain('# observed')

    const exportRoot = (await import('../config/skill-runtime.config')).getSkillRuntimeConfig().exportRoot
    const destinationDir = path.join(exportRoot, 'observability')
    fs.mkdirSync(destinationDir, { recursive: true })
    store.exportArtifact({ artifactId: artifact.id, runId: run.id, destinationDir, confirmed: true, actor: 'tester', auditReason: 'observability test' })
    expect(recordArtifact).toHaveBeenCalledWith(expect.objectContaining({
      bytes: artifact.size_bytes,
      operation: 'export',
      outcome: 'success',
      correlation: expect.objectContaining({ runId: run.id, artifactId: artifact.id }),
    }))

    expect(() => store.exportArtifact({ artifactId: artifact.id, runId: run.id, destinationDir, confirmed: true, actor: 'tester', auditReason: 'duplicate observability test' })).toThrow()
    expect(recordArtifact).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'export',
      outcome: 'error',
      correlation: expect.objectContaining({ runId: run.id, artifactId: artifact.id }),
    }))
  })
  it('accepts injected runtime ports without requiring a database repository', async () => {
    const ports = createFakeSkillRuntimePorts({ now: 10 })
    const version = ports.packages.createVersion({ packageId: 'pkg-1', version: '1.0.0', manifest: {}, manifestHash: 'hash', packagePath: '/pkg' })
    const run = ports.runs.createRun({ skillVersionId: version.id, status: 'created', input: {}, context: {} })
    const { ArtifactStore } = await import('./artifact-store')
    const store = new ArtifactStore({
      runs: ports.runs,
      events: ports.events,
      artifacts: ports.artifacts,
      clock: ports.clock,
    })

    const artifact = store.writeText({ runId: run.id, kind: 'markdown', fileName: 'injected.md', content: '# injected' })

    expect(ports.artifacts.getArtifact(artifact.id)).toMatchObject({ runId: run.id, path: 'injected.md' })
    expect(ports.events.listEvents(run.id)).toHaveLength(1)
  })
})
