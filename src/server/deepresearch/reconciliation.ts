import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { JsonObject, ResearchArtifactDto, ResearchRunDetailDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import { getDataDir } from '@server/db/paths'
import { getOrmDb } from '@server/db/client'
import { research_reconciliations } from '@server/db/schema'
import { researchAttemptRepo } from '@server/db/repositories/deepresearch/research-attempt.repo'
import { researchCheckpointRepo } from '@server/db/repositories/deepresearch/research-checkpoint.repo'
import { researchEventRepo } from '@server/db/repositories/deepresearch/research-event.repo'
import { researchReportRepo, type StoredResearchArtifact, type UpsertResearchArtifactInput } from '@server/db/repositories/deepresearch/research-report.repo'
import { researchRunRepo } from '@server/db/repositories/deepresearch/research-run.repo'
import { readArtifactReconciliationManifest, verifyArtifactReconciliationManifest, type ArtifactReconciliationManifest } from '@server/services/deepresearch/artifact-service'
import { encodeJson } from '@server/db/repositories/deepresearch/repository-utils'

const ARTIFACT_KEY_PREFIX = 'report-artifact:v1:'

export interface ReconciliationDiagnostics {
  checkpointKey: string | null
  queryCount: number
  sourceCount: number
  snapshotCount: number
  evidenceCount: number
  orphanSnapshotCount: number
  orphanEvidenceCount: number
  registeredArtifactTypes: ResearchArtifactDto['type'][]
  artifactRebuildRequired: boolean
}

export interface ReconciliationResult {
  runId: string
  reconciled: boolean
  diagnostics: ReconciliationDiagnostics
}

export interface DeepResearchReconciliationOptions {
  getRunDetail?: (runId: string) => ResearchRunDetailDto | undefined
  getRun?: (runId: string) => ResearchRunDto | undefined
  getAttempt?: (attemptId: string) => { runId: string; createdAt: number } | undefined
  getCheckpointKey?: (runId: string) => string | null
  listArtifacts?: (runId: string) => ResearchArtifactDto[]
  getStoredArtifactByIdempotencyKey?: (runId: string, key: string) => StoredResearchArtifact | undefined
  upsertArtifact?: (input: UpsertResearchArtifactInput) => ResearchArtifactDto
  setReportArtifactId?: (runId: string, artifactId: string) => ResearchRunDto
  appendEvent?: (input: { runId: string; type: 'research.recovery.reconciled'; phase: string; payload: JsonObject }) => unknown
  recordOnce?: (runId: string, reconciliationKey: string, checkpointKey: string | null, diagnostics: ReconciliationDiagnostics) => boolean
  dataDir?: string
  now?: () => number
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message)
}

function defaultRecordOnce(runId: string, reconciliationKey: string, checkpointKey: string | null, diagnostics: ReconciliationDiagnostics): boolean {
  try {
    getOrmDb().insert(research_reconciliations).values({
      id: uuidv4(),
      run_id: runId,
      reconciliation_key: reconciliationKey,
      checkpoint_key: checkpointKey,
      outcome_json: encodeJson(diagnostics),
      created_at: Date.now(),
    }).run()
    return true
  } catch (error) {
    if (isUniqueConstraint(error)) return false
    throw error
  }
}

function safeArtifactDirectory(dataDir: string, runId: string): string {
  return path.join(dataDir, 'deepresearch', 'runs', runId)
}

interface ArtifactCandidateScan {
  candidates: Array<{ storagePath: string; manifest: ArtifactReconciliationManifest }>
  hasInvalidManifest: boolean
}

function scanArtifactCandidates(directory: string): ArtifactCandidateScan {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.reconciliation.json'))
      .reduce<ArtifactCandidateScan>((scan, entry) => {
        const storagePath = path.join(directory, entry.name.slice(0, -'.reconciliation.json'.length))
        const manifest = readArtifactReconciliationManifest(storagePath)
        if (manifest && verifyArtifactReconciliationManifest(storagePath, manifest)) {
          scan.candidates.push({ storagePath, manifest })
        } else {
          scan.hasInvalidManifest = true
        }
        return scan
      }, { candidates: [], hasInvalidManifest: false })
  } catch {
    return { candidates: [], hasInvalidManifest: false }
  }
}

function reconciliationKey(run: ResearchRunDetailDto, checkpointKey: string | null, candidatesForRun: Array<{ manifest: ArtifactReconciliationManifest }>, hasInvalidManifest: boolean): string {
  const entitySummary = {
    checkpointKey,
    queries: run.searchQueries.map((query) => [query.id, query.status]),
    sources: run.sources.map((source) => source.id),
    snapshots: run.snapshots.map((snapshot) => [snapshot.id, snapshot.sourceId, snapshot.contentHash]),
    evidence: run.evidence.map((item) => [item.id, item.snapshotId]),
    candidates: candidatesForRun.map(({ manifest }) => [manifest.type, manifest.fingerprint, manifest.registrationState]),
    hasInvalidManifest,
  }
  return createHash('sha256').update(JSON.stringify(entitySummary)).digest('hex')
}

export function createDeepResearchReconciliationService(options: DeepResearchReconciliationOptions = {}) {
  const now = options.now ?? Date.now
  const getRunDetail = options.getRunDetail ?? researchRunRepo.getDetail.bind(researchRunRepo)
  const getRun = options.getRun ?? researchRunRepo.get.bind(researchRunRepo)
  const getAttempt = options.getAttempt ?? researchAttemptRepo.get.bind(researchAttemptRepo)
  const getCheckpointKey = options.getCheckpointKey ?? ((runId: string) => researchCheckpointRepo.list(runId)[0]?.checkpointKey ?? null)
  const listArtifacts = options.listArtifacts ?? researchReportRepo.listArtifacts.bind(researchReportRepo)
  const getStored = options.getStoredArtifactByIdempotencyKey ?? researchReportRepo.getStoredArtifactByIdempotencyKey.bind(researchReportRepo)
  const upsertArtifact = options.upsertArtifact ?? researchReportRepo.upsertArtifact.bind(researchReportRepo)
  const setReportArtifactId = options.setReportArtifactId ?? researchRunRepo.setReportArtifactId.bind(researchRunRepo)
  const appendEvent = options.appendEvent ?? researchEventRepo.append.bind(researchEventRepo)
  const recordOnce = options.recordOnce ?? defaultRecordOnce
  const dataDir = options.dataDir ?? getDataDir()

  function reconcileRun(runId: string): ReconciliationResult {
    const detail = getRunDetail(runId)
    const run = getRun(runId)
    if (!detail || !run) throw new Error('Deep Research Run not found: ' + runId)

    const sourceIds = new Set(detail.sources.map((source) => source.id))
    const snapshotIds = new Set(detail.snapshots.map((snapshot) => snapshot.id))
    const orphanSnapshots = detail.snapshots.filter((snapshot) => !sourceIds.has(snapshot.sourceId))
    const orphanEvidence = detail.evidence.filter((evidence) => !snapshotIds.has(evidence.snapshotId))
    const checkpointKey = getCheckpointKey(runId)
    const artifactScan = scanArtifactCandidates(safeArtifactDirectory(dataDir, runId))
    const files = artifactScan.candidates
    const registered: ResearchArtifactDto['type'][] = []

    for (const candidate of files) {
      const { manifest, storagePath } = candidate
      const attempt = getAttempt(manifest.attemptId)
      const withinRunWindow = manifest.generatedAt >= run.createdAt && manifest.generatedAt <= now() + 60_000
      if (manifest.runId !== runId || !attempt || attempt.runId !== runId || !withinRunWindow) continue
      const key = ARTIFACT_KEY_PREFIX + manifest.type
      if (getStored(runId, key)) continue
      const stat = fs.statSync(storagePath)
      const artifact = upsertArtifact({
        runId,
        type: manifest.type,
        fileName: manifest.fileName,
        contentType: manifest.type.includes('json') ? 'application/json' : 'text/markdown',
        storagePath,
        sizeBytes: stat.size,
        contentHash: manifest.contentHash,
        metadata: { generated: true, reconciliation: { attemptId: manifest.attemptId, fingerprint: manifest.fingerprint, generatedAt: manifest.generatedAt, registrationState: 'registered' } },
        idempotencyKey: key,
      })
      registered.push(artifact.type)
      if (artifact.type === 'report_markdown' && !run.reportArtifactId) setReportArtifactId(runId, artifact.id)
    }

    const artifactRebuildRequired = artifactScan.hasInvalidManifest
      || Boolean(run.reportArtifactId && !listArtifacts(runId).some((artifact) => artifact.id === run.reportArtifactId))
      || (files.length > 0 && !files.some(({ manifest }) => manifest.type === 'report_markdown'))
    const diagnostics: ReconciliationDiagnostics = {
      checkpointKey,
      queryCount: detail.searchQueries.length,
      sourceCount: detail.sources.length,
      snapshotCount: detail.snapshots.length,
      evidenceCount: detail.evidence.length,
      orphanSnapshotCount: orphanSnapshots.length,
      orphanEvidenceCount: orphanEvidence.length,
      registeredArtifactTypes: registered,
      artifactRebuildRequired,
    }
    const key = reconciliationKey(detail, checkpointKey, files, artifactScan.hasInvalidManifest)
    const reconciled = recordOnce(runId, key, checkpointKey, diagnostics)
    if (reconciled) {
      appendEvent({
        runId,
        type: 'research.recovery.reconciled',
        phase: 'reconciliation',
        payload: {
          checkpointKey,
          registeredArtifactCount: registered.length,
          orphanSnapshotCount: orphanSnapshots.length,
          orphanEvidenceCount: orphanEvidence.length,
          artifactRebuildRequired,
        },
      })
    }
    return { runId, reconciled, diagnostics }
  }

  return Object.freeze({ reconcileRun })
}
