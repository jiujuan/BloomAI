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
  const version = skillPackageRepo.createVersion({
    packageId: skillPackageRepo.createPackage({ name: 'Event fixture', description: '', sourceType: 'local-directory' }).id,
    version: '1.0.0', manifest: {}, manifestHash: 'event-fixture', packagePath: '/packages/event-fixture',
  })
  const run = skillPackageRepo.createRun({ skillVersionId: version.id, status: 'created', input: {}, context: {} })
  return { skillPackageRepo, run }
}

describe('skill run event protocol', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-skill-run-events-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('redacts nested credentials while retaining an allowed file-load summary', async () => {
    const { normalizeSkillRunEvent } = await import('./skill-run-events')

    const event = normalizeSkillRunEvent({
      type: 'package.file_loaded',
      payload: {
        path: 'references/style.md', sha256: 'abc', sizeBytes: 24,
        apiKey: 'top-secret', nested: { authorization: 'Bearer another-secret' }, headers: { 'x-api-key': 'still-secret' },
      },
    })

    expect(event.schemaVersion).toBe(1)
    expect(event.payload).toEqual({
      path: 'references/style.md', sha256: 'abc', sizeBytes: 24,
      apiKey: '[REDACTED]', nested: { authorization: '[REDACTED]' }, headers: '[REDACTED]',
    })
  })

  it('rejects base64 media and oversized text payloads', async () => {
    const { normalizeSkillRunEvent } = await import('./skill-run-events')

    expect(() => normalizeSkillRunEvent({
      type: 'step.completed', payload: { title: 'render', output: 'data:image/png;base64,AAAA' },
    })).toThrow(/base64/i)
    expect(() => normalizeSkillRunEvent({
      type: 'step.completed', payload: { title: 'render', b64_json: 'AAAA' },
    })).toThrow(/base64/i)
    expect(() => normalizeSkillRunEvent({
      type: 'step.completed', payload: { title: 'render', summary: 'x'.repeat(8_193) },
    })).toThrow(/payload/i)
  })

  it('rejects unknown event types', async () => {
    const { normalizeSkillRunEvent } = await import('./skill-run-events')
    expect(() => normalizeSkillRunEvent({ type: 'run.unknown', payload: {} })).toThrow(/event/i)
  })

  it('never persists credentials or unbounded payloads through appendEvent', async () => {
    const { skillPackageRepo, run } = await createRunFixture()

    skillPackageRepo.appendEvent({
      runId: run.id,
      seq: 1,
      type: 'step.completed',
      payload: { title: 'fetch', authorization: 'Bearer private-token' },
    })

    expect(skillPackageRepo.listEvents(run.id)[0].payload_json).toContain('[REDACTED]')
    expect(() => skillPackageRepo.appendEvent({
      runId: run.id,
      seq: 2,
      type: 'step.completed',
      payload: { title: 'fetch', raw: 'x'.repeat(8_193) },
    })).toThrow(/payload/i)
  })

  it('records artifact metadata without persisting artifact content', async () => {
    const { skillPackageRepo, run } = await createRunFixture()
    const artifact = skillPackageRepo.createArtifact({
      runId: run.id, kind: 'markdown', path: 'summary.md', sha256: 'artifact-hash', sizeBytes: 42,
      metadata: { content: 'private body' },
    })

    expect(skillPackageRepo.listEvents(run.id)).toEqual([
      expect.objectContaining({ type: 'artifact.created', payload_json: expect.not.stringContaining('private body') }),
    ])
    expect(skillPackageRepo.listEvents(run.id)[0].payload_json).toContain(artifact.id)
  })
})
