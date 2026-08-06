import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSkillRuntimePorts } from '../application/test-doubles'
import { validateArtifactInput } from './artifact-policy'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

describe('Artifact policy', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-artifact-security-'))
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

  it('rejects control characters and path-like artifact names', () => {
    expect(() => validateArtifactInput({ kind: 'markdown', fileName: `summary\u0000.md`, content: Buffer.from('ok') })).toThrow(/unsafe artifact file name/i)
    expect(() => validateArtifactInput({ kind: 'markdown', fileName: 'nested/summary.md', content: Buffer.from('ok') })).toThrow(/unsafe artifact file name/i)
  })

  it('rejects content and metadata over the configured budgets', async () => {
    process.env.SKILL_MAX_FILE_BYTES = '4'
    const { getSkillRuntimeConfig } = await import('../config/skill-runtime.config')
    expect(() => validateArtifactInput({ kind: 'markdown', fileName: 'summary.md', content: Buffer.from('12345'), maxContentBytes: getSkillRuntimeConfig().maxFileBytes })).toThrow(/content.*budget/i)
    expect(() => validateArtifactInput({ kind: 'markdown', fileName: 'summary.md', content: Buffer.from('ok'), metadata: { note: 'x'.repeat(70_000) } })).toThrow(/metadata.*budget/i)
  })

  it('provides a paged artifact summary without exposing the absolute file path', async () => {
    const { ArtifactStore } = await import('./artifact-store')
    const ports = createFakeSkillRuntimePorts({ now: 10 })
    const version = ports.packages.createVersion({ packageId: 'pkg-1', version: '1.0.0', manifest: {}, manifestHash: 'hash', packagePath: '/pkg' })
    const run = ports.runs.createRun({ skillVersionId: version.id, status: 'created', input: {}, context: {} })
    const store = new ArtifactStore({ runs: ports.runs, events: ports.events, artifacts: ports.artifacts, clock: ports.clock })
    store.writeText({ runId: run.id, kind: 'markdown', fileName: 'summary.md', content: '# Result!!!' })
    store.writeText({ runId: run.id, kind: 'markdown', fileName: 'second.md', content: '# Second' })

    const page = store.listArtifacts({ runId: run.id, limit: 1, offset: 0, sort: 'size', direction: 'desc' })

    expect(page).toMatchObject({ total: 2, limit: 1, offset: 0 })
    expect(page.data).toHaveLength(1)
    expect(page.data[0]).toMatchObject({ path: 'summary.md', summary: { contentPreview: '# Result!!!' } })
    expect(JSON.stringify(page.data[0])).not.toContain(path.resolve(dataDir))
  })

  it('cleans an expired run directory while retaining the exported copy and audit metadata', async () => {
    const { ArtifactStore } = await import('./artifact-store')
    const { getSkillRuntimeConfig } = await import('../config/skill-runtime.config')
    const ports = createFakeSkillRuntimePorts({ now: 1_000 })
    const version = ports.packages.createVersion({ packageId: 'pkg-1', version: '1.0.0', manifest: {}, manifestHash: 'hash', packagePath: '/pkg' })
    const fakeRun = ports.runs.createRun({ skillVersionId: version.id, status: 'created', input: {}, context: {} })
    const fakeStore = new ArtifactStore({ runs: ports.runs, events: ports.events, artifacts: ports.artifacts, clock: ports.clock })
    const artifact = fakeStore.writeText({ runId: fakeRun.id, kind: 'markdown', fileName: 'expired.md', content: 'expired' })
    const fakeExportRoot = getSkillRuntimeConfig().exportRoot
    const destinationDir = path.join(fakeExportRoot, 'retention')
    fs.mkdirSync(destinationDir, { recursive: true })
    fakeStore.exportArtifact({ artifactId: artifact.id, runId: fakeRun.id, destinationDir, confirmed: true, actor: 'tester', auditReason: 'retention test' })
    ports.clock.set((artifact.retentionUntil ?? 0) + 1)

    expect(fakeStore.removeRun(fakeRun.id)).toBe(true)
    expect(fs.existsSync(path.join(getSkillRuntimeConfig().artifactRoot, fakeRun.id))).toBe(false)
    expect(fs.existsSync(path.join(destinationDir, 'expired.md'))).toBe(true)
    expect(ports.artifacts.getArtifact(artifact.id)).toMatchObject({ exportedBy: 'tester' })
  })
})
