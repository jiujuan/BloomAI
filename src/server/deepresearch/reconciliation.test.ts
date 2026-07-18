import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, test } from 'vitest'
import type { ResearchArtifactDto, ResearchRunDetailDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import { artifactManifestPath, artifactReconciliationFingerprint } from '@server/services/deepresearch/artifact-service'
import { createDeepResearchReconciliationService } from './reconciliation'

const run: ResearchRunDto = {
  id: 'run-reconcile', sessionId: null, topic: 'sensitive topic is never emitted', profile: 'general', depth: 'standard',
  status: 'interrupted', phase: 'interrupted', progress: 50, brief: null, workflowRunId: null,
  budget: { maxQuestions: 1, maxIterations: 1, maxSearchQueries: 1, maxNormalizedSources: 1, maxFetchedSources: 1, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 1_000 },
  usage: { questions: 1, iterations: 0, searchQueries: 1, normalizedSources: 1, fetchedSources: 1, tokens: 0, providerCostUsd: 0, startedAt: 1, deadlineAt: null },
  quality: null, reportArtifactId: null, resumePhase: 'finalizing_artifacts', error: null, createdAt: 1, updatedAt: 1, completedAt: null,
  currentAttemptId: 'attempt-reconcile',
}

let dataDir = ''
afterEach(() => { if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true }); dataDir = '' })

function detail(): ResearchRunDetailDto {
  return {
    ...run,
    questions: [], searchQueries: [{ id: 'query-1', runId: run.id, questionId: 'question-1', query: 'private query', intent: 'initial', status: 'completed', resultCount: 0, createdAt: 1 }],
    sources: [], snapshots: [{ id: 'snapshot-orphan', runId: run.id, sourceId: 'missing-source', contentHash: 'snapshot-hash', contentType: 'text/html', content: null, fetchedAt: 1 }],
    evidence: [{ id: 'evidence-orphan', runId: run.id, questionId: 'question-1', snapshotId: 'missing-snapshot', passage: 'never copied into event', summary: 'private', stance: 'supports', confidence: 1, createdAt: 1 }],
    report: null, events: [], artifacts: [], attempts: [], iterations: [], coverageAssessments: [],
  } as unknown as ResearchRunDetailDto
}

describe('Deep Research reconciliation', () => {
  it('registers only a verifiable orphan artifact once and emits a privacy-safe diagnostic', () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-reconcile-'))
    const directory = path.join(dataDir, 'deepresearch', 'runs', run.id)
    fs.mkdirSync(directory, { recursive: true })
    const storagePath = path.join(directory, 'report.md')
    const body = '# bounded report\n'
    const contentHash = createHash('sha256').update(body).digest('hex')
    const generatedAt = 10
    const manifest = {
      version: 1 as const, runId: run.id, attemptId: 'attempt-reconcile', type: 'report_markdown' as const,
      fileName: 'report.md', contentHash, generatedAt,
      fingerprint: artifactReconciliationFingerprint({ runId: run.id, attemptId: 'attempt-reconcile', type: 'report_markdown', fileName: 'report.md', contentHash, generatedAt }),
      registrationState: 'pending' as const,
    }
    fs.writeFileSync(storagePath, body)
    fs.writeFileSync(artifactManifestPath(storagePath), JSON.stringify(manifest))

    const artifacts = new Map<string, ResearchArtifactDto>()
    const seenKeys = new Set<string>()
    const events: unknown[] = []
    let upserts = 0
    const service = createDeepResearchReconciliationService({
      dataDir,
      now: () => 100,
      getRun: () => run,
      getRunDetail: () => detail(),
      getAttempt: () => ({ runId: run.id, createdAt: 1 }),
      getCheckpointKey: () => 'workflow:finalizing_artifacts:v1',
      listArtifacts: () => [...artifacts.values()],
      getStoredArtifactByIdempotencyKey: (_runId, key) => {
        const artifact = artifacts.get(key)
        return artifact ? { artifact, storagePath, contentHash, metadata: {}, idempotencyKey: key } : undefined
      },
      upsertArtifact: (input) => {
        upserts += 1
        const existing = artifacts.get(input.idempotencyKey)
        if (existing) return existing
        const artifact: ResearchArtifactDto = { id: 'artifact-1', runId: input.runId, type: input.type, fileName: input.fileName, contentType: input.contentType, sizeBytes: input.sizeBytes, createdAt: generatedAt }
        artifacts.set(input.idempotencyKey, artifact)
        return artifact
      },
      setReportArtifactId: () => run,
      recordOnce: (_runId, key) => { if (seenKeys.has(key)) return false; seenKeys.add(key); return true },
      appendEvent: (event) => { events.push(event) },
    })

    const first = service.reconcileRun(run.id)
    const second = service.reconcileRun(run.id)

    expect(first).toMatchObject({ reconciled: true, diagnostics: { registeredArtifactTypes: ['report_markdown'], orphanSnapshotCount: 1, orphanEvidenceCount: 1 } })
    expect(second.reconciled).toBe(false)
    expect(upserts).toBe(1)
    expect(events).toEqual([expect.objectContaining({
      type: 'research.recovery.reconciled',
      payload: expect.objectContaining({ checkpointKey: 'workflow:finalizing_artifacts:v1', registeredArtifactCount: 1, orphanSnapshotCount: 1, orphanEvidenceCount: 1 }),
    })])
    expect(JSON.stringify(events)).not.toContain('bounded report')
    expect(JSON.stringify(events)).not.toContain(storagePath)
  })
})

test('does not register an orphan artifact when the manifest file name is detached from its storage file', () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-reconcile-'))
  const directory = path.join(dataDir, 'deepresearch', 'runs', run.id)
  fs.mkdirSync(directory, { recursive: true })
  const storagePath = path.join(directory, 'hidden.md')
  const body = '# misplaced artifact\n'
  const contentHash = createHash('sha256').update(body).digest('hex')
  const generatedAt = 10
  fs.writeFileSync(storagePath, body)
  fs.writeFileSync(artifactManifestPath(storagePath), JSON.stringify({
    version: 1,
    runId: run.id,
    attemptId: 'attempt-reconcile',
    type: 'report_markdown',
    fileName: 'report.md',
    contentHash,
    generatedAt,
    fingerprint: artifactReconciliationFingerprint({ runId: run.id, attemptId: 'attempt-reconcile', type: 'report_markdown', fileName: 'report.md', contentHash, generatedAt }),
    registrationState: 'pending',
  }))

  let upserts = 0
  const result = createDeepResearchReconciliationService({
    dataDir,
    now: () => 100,
    getRun: () => run,
    getRunDetail: () => ({ ...detail(), snapshots: [], evidence: [] }),
    getAttempt: () => ({ runId: run.id, createdAt: 1 }),
    getCheckpointKey: () => 'workflow:finalizing_artifacts:v1',
    listArtifacts: () => [],
    getStoredArtifactByIdempotencyKey: () => undefined,
    upsertArtifact: () => { upserts += 1; throw new Error('must not register detached artifact') },
    setReportArtifactId: () => run,
    recordOnce: () => true,
    appendEvent: () => undefined,
  }).reconcileRun(run.id)

  expect(upserts).toBe(0)
  expect(result.diagnostics.registeredArtifactTypes).toEqual([])
  expect(result.diagnostics.artifactRebuildRequired).toBe(true)
})