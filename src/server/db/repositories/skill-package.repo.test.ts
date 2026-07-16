import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadRepo() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../client')
  await client.runMigrations()
  const { skillPackageRepo } = await import('./skill-package.repo')

  return { skillPackageRepo }
}

describe('skillPackageRepo', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-skill-package-repo-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('creates package runtime records while preserving run history after uninstall deletion', async () => {
    const { skillPackageRepo } = await loadRepo()
    const pkg = skillPackageRepo.createPackage({
      name: 'Article Illustrator',
      description: 'Creates article images',
      sourceType: 'local-directory',
      sourceUri: 'fixtures/article-illustrator',
    })
    const version = skillPackageRepo.createVersion({
      packageId: pkg.id,
      version: '1.0.0',
      manifest: { name: 'Article Illustrator', runtime: 'instruction-agent' },
      manifestHash: 'hash-1',
      packagePath: '/packages/hash-1',
    })
    const installation = skillPackageRepo.createInstallation({
      packageId: pkg.id,
      currentVersionId: version.id,
      status: 'installed',
    })
    const run = skillPackageRepo.createRun({
      skillVersionId: version.id,
      status: 'created',
      input: { article: 'hello' },
      context: { surface: 'image-studio' },
      surface: 'image-studio',
    })

    skillPackageRepo.deleteInstallation(installation.id)

    expect(skillPackageRepo.getRun(run.id)?.skill_version_id).toBe(version.id)
    expect(skillPackageRepo.getVersion(version.id)?.manifest_json).toContain('Article Illustrator')
  })

  it('enforces event sequence uniqueness and artifact run ownership', async () => {
    const { skillPackageRepo } = await loadRepo()
    const version = skillPackageRepo.createVersion({
      packageId: skillPackageRepo.createPackage({ name: 'Pkg', description: '', sourceType: 'local-directory' }).id,
      version: '1.0.0',
      manifest: {},
      manifestHash: 'hash-2',
      packagePath: '/packages/hash-2',
    })
    const run = skillPackageRepo.createRun({
      skillVersionId: version.id,
      status: 'running',
      input: {},
      context: {},
    })

    const event = { schemaVersion: 1, type: 'run.status_changed', payload: { from: 'created', to: 'running', revision: 1 } }
    skillPackageRepo.appendEvent({ runId: run.id, seq: 1, ...event })
    expect(() => skillPackageRepo.appendEvent({ runId: run.id, seq: 1, ...event })).toThrow()
    expect(() =>
      skillPackageRepo.createArtifact({
        runId: 'missing-run',
        kind: 'markdown',
        path: 'summary.md',
        sha256: 'abc',
      })
    ).toThrow(/Run not found/)
  })

  it('validates JSON fields at the repository boundary', async () => {
    const { skillPackageRepo } = await loadRepo()

    expect(() =>
      skillPackageRepo.createVersion({
        packageId: 'package-id',
        version: '1.0.0',
        manifest: [] as any,
        manifestHash: 'hash',
        packagePath: '/packages/hash',
      })
    ).toThrow(/manifest must be a JSON object/)
  })

  it('keeps database-level foreign keys active for run version locks', async () => {
    await loadRepo()
    const db = new DatabaseSync(path.join(dataDir, 'bloomai.db'))
    try {
      expect(() =>
        db.exec(`
          INSERT INTO skill_runs_v2 (id, skill_version_id, status, input_json, context_json, updated_at)
          VALUES ('run-without-version', 'missing-version', 'created', '{}', '{}', 1);
        `)
      ).toThrow()
    } finally {
      db.close()
    }
  })

  it('persists session-bound grants and atomically consumes once grants', async () => {
    const { skillPackageRepo } = await loadRepo()
    const version = skillPackageRepo.createVersion({
      packageId: skillPackageRepo.createPackage({ name: 'Policy Pkg', description: '', sourceType: 'local-directory' }).id,
      version: '1.0.0',
      manifest: {},
      manifestHash: 'policy-hash',
      packagePath: '/packages/policy-hash',
    })
    const sessionGrant = skillPackageRepo.createCapabilityGrant({
      skillVersionId: version.id,
      capability: 'web.fetch',
      grantMode: 'session',
      sessionId: 'session-1',
      grantedBy: 'user-1',
      scope: { allowedDomains: ['docs.example.test'] },
    })
    const onceGrant = skillPackageRepo.createCapabilityGrant({
      skillVersionId: version.id,
      capability: 'image.generate',
      grantMode: 'once',
      grantedBy: 'user-1',
      scope: { allowedModels: ['agnes-image-2.1-flash'], maxCalls: 1 },
    })

    expect(skillPackageRepo.findActiveCapabilityGrant({
      skillVersionId: version.id,
      capability: 'web.fetch',
      sessionId: 'session-1',
    })?.id).toBe(sessionGrant.id)
    expect(skillPackageRepo.findActiveCapabilityGrant({
      skillVersionId: version.id,
      capability: 'web.fetch',
      sessionId: 'other-session',
    })).toBeUndefined()

    expect(skillPackageRepo.consumeCapabilityGrant(onceGrant.id)).toBe(true)
    expect(skillPackageRepo.consumeCapabilityGrant(onceGrant.id)).toBe(false)
    expect(skillPackageRepo.revokeCapabilityGrant(sessionGrant.id)).toBe(true)
    expect(skillPackageRepo.findActiveCapabilityGrant({
      skillVersionId: version.id,
      capability: 'web.fetch',
      sessionId: 'session-1',
    })).toBeUndefined()
  })

})
