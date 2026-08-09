import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import {
  closeDb,
  getOrmDb,
  getSkillRuntimeMigrationStatus,
  runMigrations,
} from '../src/server/db/client'
import * as schema from '../src/server/db/schema'
import { legacyMigrationRepo } from '../src/server/db/repositories/legacy-migration.repo'
import { skillPackageRepo } from '../src/server/db/repositories/skill-package.repo'
import {
  buildLegacyMigrationPlan,
  createBackupManifest,
  evaluateLegacyMigrationGate,
  reconcileLegacyMigrationCounts,
  runLegacyMigrationPlan,
  sha256,
} from '../src/server/skills/migration/legacy-data-migration'
import { canonicalJsonString } from '../src/server/skills/migration/source-normalizer'
import { redactSecretText, redactWithStats } from '../src/server/skills/migration/secret-redactor'

type LegacySkillRow = {
  id: string
  name: string
  description: string
  type: string
  source: string
  params_schema: string
  author: string
  version: string
  is_public: number
  is_installed: number
  install_count: number
  created_at: number
}

type LegacyRunRow = {
  id: string
  skill_id: string
  input_json: string
  output_json: string | null
  status: string
  duration_ms: number | null
  created_at: number
}

type CreatedPackage = ReturnType<typeof skillPackageRepo.createPackageVersionInstallationTransaction>

const KNOWN_SECRETS = [
  'Bearer do-not-leak',
  'api-key-value',
  'secret-query',
  'process.env.SECRET',
  'should-not-leak',
] as const

function countRows(table: unknown): number {
  return (getOrmDb().select().from(table as any).all() as unknown[]).length
}

function getTargetCounts() {
  return {
    packages: countRows(schema.skill_packages),
    versions: countRows(schema.skill_versions),
    installations: countRows(schema.skill_installations),
    runs: countRows(schema.skill_runs_v2),
    artifacts: countRows(schema.skill_artifacts),
  }
}

function buildSourceRows(now: number): { skills: LegacySkillRow[]; runs: LegacyRunRow[] } {
  return {
    skills: [
      {
        id: 'legacy-prompt',
        name: 'Offline Prompt Template',
        description: 'Offline one-time migration verification fixture',
        type: 'prompt-template',
        source: 'Hello {{name}}',
        params_schema: '{}',
        author: 'offline-verifier',
        version: '1.0.0',
        is_public: 0,
        is_installed: 1,
        install_count: 0,
        created_at: now,
      },
      {
        id: 'legacy-http',
        name: 'Offline HTTP API',
        description: 'Must remain manual review only',
        type: 'http-api',
        source: JSON.stringify({
          url: 'http://127.0.0.1:8080/items?token=secret-query',
          method: 'POST',
          headers: { Authorization: 'Bearer do-not-leak', 'X-Api-Key': 'api-key-value' },
          body: { prompt: 'hello' },
          followRedirects: true,
        }),
        params_schema: '{}',
        author: 'offline-verifier',
        version: '1.0.0',
        is_public: 0,
        is_installed: 1,
        install_count: 0,
        created_at: now,
      },
      {
        id: 'legacy-js',
        name: 'Offline JavaScript Function',
        description: 'Must remain critical blocked',
        type: 'js-function',
        source: 'module.exports = () => process.env.SECRET',
        params_schema: '{}',
        author: 'offline-verifier',
        version: '1.0.0',
        is_public: 0,
        is_installed: 1,
        install_count: 0,
        created_at: now,
      },
      {
        id: 'legacy-unknown',
        name: 'Offline Unknown Skill',
        description: 'Must fail closed',
        type: 'unknown-runtime',
        source: 'should-not-leak',
        params_schema: '{}',
        author: 'offline-verifier',
        version: '1.0.0',
        is_public: 0,
        is_installed: 1,
        install_count: 0,
        created_at: now,
      },
    ],
    runs: [
      { id: 'legacy-run-1', skill_id: 'legacy-prompt', input_json: '{"name":"Ada"}', output_json: '{"ok":true}', status: 'completed', duration_ms: 12, created_at: now },
      { id: 'legacy-run-2', skill_id: 'legacy-http', input_json: '{"token":"secret-query"}', output_json: null, status: 'failed', duration_ms: 8, created_at: now },
    ],
  }
}

function toMigrationSource(row: LegacySkillRow): Record<string, unknown> {
  return {
    id: row.id,
    legacySkillId: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    source: row.source,
    version: row.version,
    params_schema: row.params_schema,
    metadata: { author: row.author },
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function main(): Promise<void> {
  const originalDataDir = process.env.DATA_DIR
  const originalSkillArtifactRoot = process.env.SKILL_ARTIFACT_ROOT
  const originalVitest = process.env.VITEST
  const originalFetch = globalThis.fetch
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-skills-migration-'))
  const backupDir = process.env.LEGACY_MIGRATION_BACKUP_DIR
    ? path.resolve(process.env.LEGACY_MIGRATION_BACKUP_DIR)
    : path.join(os.tmpdir(), 'bloomai-legacy-migration-backups', `${Date.now()}-${path.basename(dataDir)}`)
  const artifactRoot = path.join(dataDir, 'artifacts')
  const now = Date.now()
  let externalNetworkCalls = 0
  let migrationRunId: string | undefined
  let backupManifest: ReturnType<typeof createBackupManifest> | undefined
  let rollbackDb = (): void => {}
  let rollbackPerformed = false
  let rollbackError: string | null = null

  process.env.DATA_DIR = dataDir
  process.env.SKILL_ARTIFACT_ROOT = artifactRoot
  process.env.VITEST = 'true'
  globalThis.fetch = (async (..._args: Parameters<typeof fetch>) => {
    externalNetworkCalls += 1
    throw new Error('External network access is forbidden during offline migration verification')
  }) as typeof fetch

  try {
    await runMigrations()
    const db = getOrmDb()
    const source = buildSourceRows(now)
    db.insert(schema.skills).values(source.skills).run()
    db.insert(schema.skill_runs).values(source.runs).run()

    const targetCountsBefore = getTargetCounts()
    const sourceInputs = source.skills.map(toMigrationSource)
    const plan = buildLegacyMigrationPlan({
      sourceSkills: sourceInputs,
      sourceRunCount: source.runs.length,
      targetCountsBefore,
      now,
    })

    backupManifest = createBackupManifest({
      backupDir,
      databasePath: path.join(dataDir, 'bloomai.db'),
      sourceCounts: plan.sourceCounts,
      tables: { skills: source.skills, skill_runs: source.runs },
      knownSecrets: KNOWN_SECRETS,
      now,
    })

    const migrationStatus = getSkillRuntimeMigrationStatus()
    assert.equal(migrationStatus.current, '047-legacy-migration-archive-and-gates')
    assert.ok(migrationStatus.applied.includes('047-legacy-migration-archive-and-gates'))
    const packageRuntimeInvariant = {
      migrationVersion: migrationStatus.current,
      targetTables: ['skill_packages', 'skill_versions', 'skill_installations', 'skill_runs_v2', 'skill_artifacts'],
      targetCountsBefore,
      orphanedTargetRowsBefore: 0,
    }
    // No Hono app or HTTP route is imported here: Legacy writes are disabled before
    // this one-time offline archive/conversion pass starts.
    const legacyWritesDisabled = true

    migrationRunId = `offline-p4-003-${uuidv4()}`
    legacyMigrationRepo.createRun({
      id: migrationRunId,
      phase: 'P4-003',
      status: 'running',
      backupManifestPath: backupManifest.manifestPath,
      backupManifestSha256: backupManifest.sha256,
      sourceCounts: plan.sourceCounts,
      targetCountsBefore,
      targetCountsAfter: targetCountsBefore,
      reconciliation: {},
      manualReviewCount: plan.items.filter((item) => item.action === 'manual_review').length,
      gateStatus: 'running',
      rollback: { backupRetained: true, dropOldTables: false },
    })

    const sourceById = new Map(source.skills.map((row) => [row.id, row]))
    const createdArchives: string[] = []
    const createdMigrations: string[] = []
    const createdAudits: string[] = []
    const createdPackages: CreatedPackage[] = []

    rollbackDb = () => {
      const rollbackDatabase = getOrmDb()
      for (const created of [...createdPackages].reverse()) {
        rollbackDatabase.delete(schema.skill_installations).where(eq(schema.skill_installations.id, created.installation.id)).run()
        rollbackDatabase.delete(schema.skill_version_snapshots).where(eq(schema.skill_version_snapshots.id, created.snapshot.id)).run()
        rollbackDatabase.delete(schema.skill_versions).where(eq(schema.skill_versions.id, created.version.id)).run()
        rollbackDatabase.delete(schema.skill_packages).where(eq(schema.skill_packages.id, created.package.id)).run()
      }
      for (const id of createdAudits) rollbackDatabase.delete(schema.skill_audit_events).where(eq(schema.skill_audit_events.id, id)).run()
      for (const id of createdMigrations) rollbackDatabase.delete(schema.skill_legacy_migrations).where(eq(schema.skill_legacy_migrations.id, id)).run()
      for (const id of createdArchives) rollbackDatabase.delete(schema.skill_legacy_archives).where(eq(schema.skill_legacy_archives.id, id)).run()
      rollbackPerformed = true
    }

    const execution = runLegacyMigrationPlan(plan, {
      archiveSkill: (item) => {
        const row = sourceById.get(item.legacySkillId)
        assert.ok(row, `Legacy source row not found: ${item.legacySkillId}`)
        const redacted = redactWithStats(row, { knownSecrets: KNOWN_SECRETS })
        const archive = legacyMigrationRepo.archiveSource({
          archiveKey: `skill:${item.legacySkillId}`,
          sourceType: 'skill',
          legacySkillId: item.legacySkillId,
          sourceSha256: item.sourceSha256,
          payload: redacted.value,
          redaction: redacted.stats,
        })
        if (!createdArchives.includes(archive.id)) createdArchives.push(archive.id)
        if (item.action === 'manual_review') {
          const migration = legacyMigrationRepo.createPreview({
            legacySkillId: item.legacySkillId,
            legacyType: row.type,
            sourceSha256: item.sourceSha256,
            decision: item.decision,
            status: item.decision === 'manual_review' ? 'manual_review_required' : 'migration_blocked',
            ownerId: 'offline-migration',
            createdBy: 'verify-legacy-skills-migration',
            preview: jsonObject(redactWithStats(item.preview, { knownSecrets: KNOWN_SECRETS }).value),
            warnings: item.decision === 'manual_review' ? [item.preview.result] : [],
            sideEffects: jsonObject(item.preview.result.sideEffects),
          })
          if (!createdMigrations.includes(migration.id)) createdMigrations.push(migration.id)
        }
      },
      archiveRuns: () => {
        for (const row of source.runs) {
          const redacted = redactWithStats(row, { knownSecrets: KNOWN_SECRETS })
          const archive = legacyMigrationRepo.archiveSource({
            archiveKey: `skill-run:${row.id}`,
            sourceType: 'skill_run',
            legacySkillId: row.skill_id,
            sourceSha256: sha256(canonicalJsonString(row)),
            payload: redacted.value,
            redaction: redacted.stats,
          })
          if (!createdArchives.includes(archive.id)) createdArchives.push(archive.id)
        }
      },
      convert: (item) => {
        const row = sourceById.get(item.legacySkillId)
        assert.ok(row, `Legacy source row not found: ${item.legacySkillId}`)
        assert.equal(item.preview.result.kind, 'package-draft-candidate')
        const candidate = item.preview.result as any
        const skillMd = String(candidate.content?.skillMd ?? '')
        const skillMdHash = sha256(skillMd)
        const packageResult = skillPackageRepo.createPackageVersionInstallationTransaction({
          package: {
            name: String(candidate.content?.name ?? row.name),
            description: String(candidate.content?.description ?? row.description),
            sourceType: 'legacy-migration',
            sourceRef: item.legacySkillId,
          },
          version: {
            version: String(candidate.content?.version ?? row.version),
            manifest: jsonObject(candidate.manifest),
            manifestHash: sha256(canonicalJsonString(candidate.manifest)),
            packagePath: `legacy-archive/${item.legacySkillId}`,
            sourceSnapshot: {
              legacySkillId: item.legacySkillId,
              sourceSha256: item.sourceSha256,
              migration: 'P4-003-offline-one-time',
            },
            immutableHash: sha256(canonicalJsonString({ manifest: candidate.manifest, skillMdHash })),
            status: 'runnable',
            securityStatus: 'reviewed',
            snapshotHash: skillMdHash,
            securityFindings: {},
          },
          snapshot: {
            filesManifest: { 'SKILL.md': { sha256: skillMdHash, sizeBytes: Buffer.byteLength(skillMd, 'utf8') } },
            totalBytes: Buffer.byteLength(skillMd, 'utf8'),
            fileCount: 1,
            snapshotRoot: `legacy-archive/${item.legacySkillId}`,
            snapshotHash: skillMdHash,
          },
          installation: { status: 'installed', enabled: true },
        })
        createdPackages.push(packageResult)

        const migration = legacyMigrationRepo.createPreview({
          legacySkillId: item.legacySkillId,
          legacyType: row.type,
          sourceSha256: item.sourceSha256,
          decision: 'auto_convertible',
          status: 'migration_previewed',
          ownerId: 'offline-migration',
          createdBy: 'verify-legacy-skills-migration',
          preview: jsonObject(redactWithStats(item.preview, { knownSecrets: KNOWN_SECRETS }).value),
          warnings: Array.isArray(candidate.warnings) ? candidate.warnings : [],
          sideEffects: jsonObject(candidate.sideEffects),
        })
        if (!createdMigrations.includes(migration.id)) createdMigrations.push(migration.id)
        const published = legacyMigrationRepo.markPublished({
          id: migration.id,
          ownerId: 'offline-migration',
          expectedRevision: migration.revision,
          packageId: packageResult.package.id,
          packageVersionId: packageResult.version.id,
        })
        assert.ok(published)
        const auditId = uuidv4()
        getOrmDb().insert(schema.skill_audit_events).values({
          id: auditId,
          actor: 'offline-migration',
          action: 'legacy_migration_published',
          resource_type: 'legacy_skill',
          resource_id: item.legacySkillId,
          payload_json: JSON.stringify({ packageId: packageResult.package.id, packageVersionId: packageResult.version.id }),
          security_decision: 'approved',
          policy_version: 'p4-003',
          source_fingerprint: item.sourceSha256,
          created_at: Date.now(),
        }).run()
        createdAudits.push(auditId)
      },
      rollback: rollbackDb,
    })

    const targetCountsAfter = getTargetCounts()
    const migrationRows = getOrmDb().select().from(schema.skill_legacy_migrations).all() as any[]
    const packageRows = getOrmDb().select().from(schema.skill_packages).all() as any[]
    const versionRows = getOrmDb().select().from(schema.skill_versions).all() as any[]
    const snapshotRows = getOrmDb().select().from(schema.skill_version_snapshots).all() as any[]
    const installationRows = getOrmDb().select().from(schema.skill_installations).all() as any[]
    const auditRows = getOrmDb().select().from(schema.skill_audit_events).all() as any[]
    const packageById = new Map(packageRows.map((row) => [row.id, row]))
    const versionById = new Map(versionRows.map((row) => [row.id, row]))
    const snapshotByVersion = new Map(snapshotRows.map((row) => [row.version_id, row]))
    const installationByPackageVersion = new Map(installationRows.map((row) => [`${row.package_id}:${row.current_version_id}`, row]))
    const orphanedMappings = migrationRows.filter((row) => {
      if (row.status !== 'migration_published') return false
      return !row.package_id
        || !row.package_version_id
        || !packageById.has(row.package_id)
        || !versionById.has(row.package_version_id)
        || versionById.get(row.package_version_id)?.package_id !== row.package_id
        || !snapshotByVersion.has(row.package_version_id)
        || !installationByPackageVersion.has(`${row.package_id}:${row.package_version_id}`)
        || !auditRows.some((audit) => audit.resource_id === row.legacy_skill_id && audit.source_fingerprint === row.source_sha256)
    }).length
    const digestMismatches = plan.items.filter((item) => legacyMigrationRepo.getArchiveByKey(`skill:${item.legacySkillId}`)?.sourceSha256 !== item.sourceSha256).length
    const artifactRows = getOrmDb().select().from(schema.skill_artifacts).all() as any[]
    const artifactOwnershipMismatches = artifactRows.filter((row) => row.skill_version_id !== null && !versionById.has(row.skill_version_id)).length
    const reconciliation = reconcileLegacyMigrationCounts({
      sourceCounts: plan.sourceCounts,
      targetCountsBefore,
      targetCountsAfter,
      expectedTargetDelta: plan.expectedTargetDelta,
      archivedCounts: { skills: execution.archivedSkillCount, runs: execution.archivedRunCount },
      manualReviewCount: execution.manualReviewCount,
      orphanedMappings,
      digestMismatches,
      artifactOwnershipMismatches,
    })
    assert.equal(reconciliation.ok, true)
    const gate = evaluateLegacyMigrationGate(reconciliation)
    assert.equal(gate.allowed, false)
    assert.match(gate.reason, /manual review/)

    let rollbackRehearsal = false
    const rehearsalPlan = { ...plan, items: plan.items.slice(0, 1) }
    assert.throws(() => runLegacyMigrationPlan(rehearsalPlan, {
      archiveSkill: () => {},
      archiveRuns: () => {},
      convert: () => { throw new Error('simulated conversion failure') },
      rollback: () => { rollbackRehearsal = true },
    }), /simulated conversion failure/)
    assert.equal(rollbackRehearsal, true)

    const updatedRun = legacyMigrationRepo.updateRun({
      id: migrationRunId,
      status: execution.status,
      targetCountsAfter,
      reconciliation: { ...reconciliation, gate },
      manualReviewCount: execution.manualReviewCount,
      gateStatus: 'blocked_manual_review',
      rollback: { backupRetained: true, rollbackRehearsal, dropOldTables: false },
      lastError: null,
    })
    assert.ok(updatedRun)
    assert.equal(updatedRun?.backupManifestSha256, backupManifest.sha256)

    const output = {
      mode: 'offline-one-time-read-only-migration-verification',
      migrationRunId,
      migrationVersion: migrationStatus.current,
      backup: {
        manifestPath: backupManifest.manifestPath,
        sha256: backupManifest.sha256,
        retained: fs.existsSync(backupManifest.manifestPath),
      },
      sourceCounts: plan.sourceCounts,
      targetCountsBefore,
      targetCountsAfter,
      delta: reconciliation.deltas,
      expectedTargetDelta: reconciliation.expectedTargetDelta,
      archivedCounts: reconciliation.archivedCounts,
      manualReviewCount: reconciliation.manualReviewCount,
      gate: { ...gate, dropOldTables: false },
      rollback: { rehearsalPassed: rollbackRehearsal, rollbackPerformed, rollbackError },
      packageRuntimeInvariant,
      legacyWritesDisabled,
      externalNetworkCalls,
      secretLeak: false,
    }
    const outputText = JSON.stringify(output)
    for (const secret of KNOWN_SECRETS) assert.equal(outputText.includes(secret), false)
    assert.equal(externalNetworkCalls, 0)
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  } catch (error) {
    const message = redactSecretText(error instanceof Error ? error.message : String(error), KNOWN_SECRETS)
    if (migrationRunId && backupManifest) {
      try {
        rollbackDb()
      } catch (rollbackFailure) {
        rollbackError = redactSecretText(rollbackFailure instanceof Error ? rollbackFailure.message : String(rollbackFailure), KNOWN_SECRETS)
      }
      try {
        legacyMigrationRepo.markRunFailed({
          id: migrationRunId,
          error: message,
          rollback: { backupRetained: fs.existsSync(backupManifest.manifestPath), rollbackPerformed, rollbackError, dropOldTables: false },
        })
      } catch {
        // Preserve the original failure while retaining the backup manifest.
      }
    }
    throw new Error(message, { cause: error })
  } finally {
    try { closeDb() } catch (error) { console.error('Database cleanup failed:', error) }
    if (originalDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = originalDataDir
    if (originalSkillArtifactRoot === undefined) delete process.env.SKILL_ARTIFACT_ROOT
    else process.env.SKILL_ARTIFACT_ROOT = originalSkillArtifactRoot
    if (originalVitest === undefined) delete process.env.VITEST
    else process.env.VITEST = originalVitest
    globalThis.fetch = originalFetch
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
