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

  it('persists security findings and audit decisions without exposing secret payloads', async () => {
    const { skillPackageRepo } = await loadRepo()
    const pkg = skillPackageRepo.createPackage({ name: 'Security Pkg', description: '', sourceType: 'local-directory' })
    const version = skillPackageRepo.createVersion({
      packageId: pkg.id,
      version: '1.0.0',
      manifest: {},
      manifestHash: 'security-manifest',
      packagePath: '/packages/security',
      securityFindings: { rejectedFiles: ['run.sh'], apiKey: 'secret-value' },
    })
    const review = skillPackageRepo.createImportReview({
      source: 'local-directory',
      sourceSha: 'security-source',
      inspection: { files: 1 },
      securityFindings: { dangerousFiles: ['run.sh'], token: 'secret-value' },
    })

    skillPackageRepo.updateImportReview(review.id, {
      securityFindings: { dangerousFiles: ['run.sh'], password: 'secret-value' },
    })
    const sourceFingerprint = 'a'.repeat(64)
    skillPackageRepo.appendAudit({
      actor: 'security-reviewer',
      action: 'security.decision',
      resourceType: 'skill-version',
      resourceId: version.id,
      securityDecision: 'rejected',
      policyVersion: 'skills-security-v1',
      sourceFingerprint,
      payload: { token: 'secret-value', reason: 'dangerous file' },
    })

    expect(skillPackageRepo.getVersion(version.id)).toMatchObject({ security_findings_json: '{"rejectedFiles":["run.sh"],"apiKey":"[REDACTED]"}' })
    expect(skillPackageRepo.getImportReview(review.id)).toMatchObject({ security_findings_json: '{"dangerousFiles":["run.sh"],"password":"[REDACTED]"}' })
    const db = new DatabaseSync(path.join(dataDir, 'bloomai.db'))
    try {
      expect(db.prepare(`
        SELECT security_decision, policy_version, source_fingerprint, payload_json
        FROM skill_audit_events WHERE resource_id = ?
      `).get(version.id)).toEqual({
        security_decision: 'rejected',
        policy_version: 'skills-security-v1',
        source_fingerprint: sourceFingerprint,
        payload_json: '{"token":"[REDACTED]","reason":"dangerous file"}',
      })
    } finally {
      db.close()
    }
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

  it('stores immutable version lifecycle fields and switches installations with CAS and idempotency', async () => {
    const { skillPackageRepo } = await loadRepo()
    const pkg = skillPackageRepo.createPackage({ name: 'Versioned Pkg', description: '', sourceType: 'local-directory' })
    const first = skillPackageRepo.createVersion({
      packageId: pkg.id,
      version: '1.0.0',
      manifest: { name: 'v1' },
      manifestHash: 'manifest-v1',
      packagePath: '/packages/v1',
      immutableHash: 'immutable-v1',
      status: 'runnable',
      securityStatus: 'verified',
      snapshotHash: 'snapshot-v1',
    })
    const second = skillPackageRepo.createVersion({
      packageId: pkg.id,
      version: '2.0.0',
      manifest: { name: 'v2' },
      manifestHash: 'manifest-v2',
      packagePath: '/packages/v2',
      immutableHash: 'immutable-v2',
      status: 'runnable',
      securityStatus: 'verified',
      snapshotHash: 'snapshot-v2',
    })
    const installation = skillPackageRepo.createInstallation({ packageId: pkg.id, currentVersionId: first.id, status: 'installed' })

    expect(skillPackageRepo.findVersionByImmutableHash(pkg.id, 'immutable-v2')?.id).toBe(second.id)
    expect(skillPackageRepo.getVersion(second.id)).toMatchObject({ immutable_hash: 'immutable-v2', status: 'runnable', security_status: 'verified', snapshot_hash: 'snapshot-v2' })

    const switched = skillPackageRepo.switchCurrentVersion({ installationId: installation.id, versionId: second.id, expectedRevision: 0, idempotencyKey: 'switch-v2' })
    expect(switched).toMatchObject({ current_version_id: second.id, previous_version_id: first.id, revision: 1 })
    expect(skillPackageRepo.switchCurrentVersion({ installationId: installation.id, versionId: first.id, expectedRevision: 0, idempotencyKey: 'stale' })).toBeUndefined()
    expect(skillPackageRepo.switchCurrentVersion({ installationId: installation.id, versionId: second.id, expectedRevision: 0, idempotencyKey: 'switch-v2' })).toMatchObject({ current_version_id: second.id, revision: 1 })
  })

  it('rejects unreviewed version switches, protects enable CAS, and resolves no version after disable', async () => {
    const { skillPackageRepo } = await loadRepo()
    const pkg = skillPackageRepo.createPackage({ name: 'Lifecycle Pkg', description: '', sourceType: 'local-directory' })
    const verified = skillPackageRepo.createVersion({
      packageId: pkg.id,
      version: '1.0.0',
      manifest: { name: 'verified' },
      manifestHash: 'lifecycle-v1',
      packagePath: '/packages/lifecycle-v1',
      status: 'runnable',
      securityStatus: 'verified',
    })
    const unreviewed = skillPackageRepo.createVersion({
      packageId: pkg.id,
      version: '2.0.0',
      manifest: { name: 'unreviewed' },
      manifestHash: 'lifecycle-v2',
      packagePath: '/packages/lifecycle-v2',
      status: 'runnable',
      securityStatus: 'unreviewed',
    })
    const otherPackage = skillPackageRepo.createPackage({ name: 'Other Lifecycle Pkg', description: '', sourceType: 'local-directory' })
    const otherVersion = skillPackageRepo.createVersion({
      packageId: otherPackage.id,
      version: '1.0.0',
      manifest: { name: 'other' },
      manifestHash: 'lifecycle-other',
      packagePath: '/packages/lifecycle-other',
      status: 'runnable',
      securityStatus: 'verified',
    })
    const installation = skillPackageRepo.createInstallation({ packageId: pkg.id, currentVersionId: verified.id, status: 'installed' })

    expect(skillPackageRepo.switchCurrentVersion({ installationId: installation.id, versionId: unreviewed.id, expectedRevision: 0, idempotencyKey: 'switch-unreviewed' })).toBeUndefined()
    expect(skillPackageRepo.switchCurrentVersion({ installationId: installation.id, versionId: otherVersion.id, expectedRevision: 0, idempotencyKey: 'switch-cross-package' })).toBeUndefined()
    expect(skillPackageRepo.setInstallationEnabledCas({ installationId: installation.id, enabled: true, expectedRevision: 0, idempotencyKey: 'enable-valid' })).toMatchObject({ revision: 1, enabled: 1 })

    const disabled = skillPackageRepo.setInstallationEnabledCas({ installationId: installation.id, enabled: false, expectedRevision: 1, idempotencyKey: 'disable-valid' })
    expect(disabled).toMatchObject({ revision: 2, enabled: 0, status: 'disabled' })
    expect(skillPackageRepo.resolveRunnableVersion(installation.id)).toBeUndefined()
    expect(skillPackageRepo.resolveRunnableVersion(pkg.id)).toBeUndefined()
  })

  it('uninstalls idempotently while preserving installation, run, event, and audit history', async () => {
    const { skillPackageRepo } = await loadRepo()
    const pkg = skillPackageRepo.createPackage({ name: 'Uninstall Pkg', description: '', sourceType: 'local-directory' })
    const version = skillPackageRepo.createVersion({
      packageId: pkg.id,
      version: '1.0.0',
      manifest: { name: 'uninstall' },
      manifestHash: 'uninstall-v1',
      packagePath: '/packages/uninstall-v1',
      status: 'runnable',
      securityStatus: 'verified',
    })
    const installation = skillPackageRepo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'installed' })
    const run = skillPackageRepo.createRun({ skillVersionId: version.id, status: 'created', input: {}, context: {} })
    skillPackageRepo.appendEvent({ runId: run.id, seq: 1, schemaVersion: 1, type: 'run.created', payload: {} })
    skillPackageRepo.appendAudit({ action: 'skill.installation.created', resourceType: 'skill_installation', resourceId: installation.id, payload: { reason: 'test' } })

    const first = skillPackageRepo.uninstallInstallation({ installationId: installation.id, expectedRevision: 0, idempotencyKey: 'uninstall-once' })
    const second = skillPackageRepo.uninstallInstallation({ installationId: installation.id, expectedRevision: 0, idempotencyKey: 'uninstall-once' })

    expect(second).toEqual(first)
    expect(skillPackageRepo.getInstallation(installation.id)).toMatchObject({ status: 'uninstalled', enabled: 0, revision: 1 })
    expect(skillPackageRepo.getRun(run.id)).toMatchObject({ id: run.id, skill_version_id: version.id })
    expect(skillPackageRepo.listEvents(run.id, { afterSeq: 0 })).toHaveLength(1)
    const db = new DatabaseSync(path.join(dataDir, 'bloomai.db'))
    try {
      expect(db.prepare('SELECT COUNT(*) AS count FROM skill_installation_commands WHERE installation_id = ?').get(installation.id)).toEqual({ count: 1 })
      expect(db.prepare('SELECT COUNT(*) AS count FROM skill_audit_events WHERE resource_id = ?').get(installation.id)).toEqual({ count: 1 })
    } finally {
      db.close()
    }
  })

  it('hides archived packages from the catalog while retaining package, version, run, and audit history', async () => {
    const { skillPackageRepo } = await loadRepo()
    const active = skillPackageRepo.createPackage({ name: 'Active', description: '', sourceType: 'local-directory' })
    const archived = skillPackageRepo.createPackage({ name: 'Archived', description: '', sourceType: 'local-directory' })
    const version = skillPackageRepo.createVersion({
      packageId: archived.id,
      version: '1.0.0',
      manifest: { name: 'Archived' },
      manifestHash: 'archived-manifest',
      packagePath: '/packages/archived',
    })
    const run = skillPackageRepo.createRun({ skillVersionId: version.id, status: 'completed', input: {}, context: {} })
    skillPackageRepo.appendAudit({ action: 'skill.package.imported', resourceType: 'skill_package', resourceId: archived.id, payload: { reason: 'test' } })

    const deletedAt = 123
    const deleted = skillPackageRepo.softDeletePackage({ packageId: archived.id, idempotencyKey: 'archive-1', reason: 'retired' })

    expect(deleted).toMatchObject({ id: archived.id, deleted_at: expect.any(Number), delete_reason: 'retired' })
    expect(skillPackageRepo.listPackages({ limit: 20, offset: 0 })).toMatchObject({ total: 1, data: [{ id: active.id }] })
    expect(skillPackageRepo.getPackage(archived.id)).toMatchObject({ deleted_at: expect.any(Number), delete_reason: 'retired' })
    expect(skillPackageRepo.getVersion(version.id)).toMatchObject({ id: version.id })
    expect(skillPackageRepo.getRun(run.id)).toMatchObject({ id: run.id, skill_version_id: version.id })

    const db = new DatabaseSync(path.join(dataDir, 'bloomai.db'))
    try {
      expect(db.prepare("SELECT COUNT(*) AS count FROM skill_audit_events WHERE resource_id = ?").get(archived.id)).toEqual({ count: 1 })
      expect(deleted?.deleted_at).toBeGreaterThanOrEqual(deletedAt)
    } finally {
      db.close()
    }
  })

})
