import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getResearchBudget } from '@server/deepresearch/domain/budgets'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadRepositories() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../../client')
  await client.runMigrations()
  const { researchRunRepo } = await import('./research-run.repo')
  const { researchQuestionRepo } = await import('./research-question.repo')
  const { researchSourceRepo } = await import('./research-source.repo')
  const { researchEvidenceRepo } = await import('./research-evidence.repo')
  const { researchReportRepo } = await import('./research-report.repo')
  const { researchEventRepo } = await import('./research-event.repo')

  return {
    client,
    researchRunRepo,
    researchQuestionRepo,
    researchSourceRepo,
    researchEvidenceRepo,
    researchReportRepo,
    researchEventRepo,
  }
}

function createRun(researchRunRepo: Awaited<ReturnType<typeof loadRepositories>>['researchRunRepo']) {
  return researchRunRepo.create({
    input: {
      topic: 'Enterprise AI assistant market',
      profile: 'market',
      depth: 'deep',
      objective: 'Compare the market and leading vendors.',
    },
    budget: getResearchBudget('deep'),
  })
}

describe('Deep Research repositories', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-deepresearch-repo-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('commits a legal status transition and its event together with monotonic sequences', async () => {
    const { researchRunRepo, researchEventRepo } = await loadRepositories()
    const run = createRun(researchRunRepo)

    const transitioned = researchRunRepo.transitionWithEvent(run.id, 'planning')
    researchEventRepo.append({
      runId: run.id,
      type: 'research.brief.completed',
      phase: 'planning',
      payload: { id: 'brief-1' },
    })

    expect(transitioned).toMatchObject({ status: 'planning', phase: 'planning' })
    expect(researchEventRepo.list(run.id).map((event) => [event.sequence, event.type])).toEqual([
      [1, 'research.run.status_changed'],
      [2, 'research.brief.completed'],
    ])
    expect(researchEventRepo.list(run.id, 1).map((event) => event.sequence)).toEqual([2])
    expect(() => researchRunRepo.transitionWithEvent(run.id, 'completed')).toThrowError('RESEARCH_INVALID_TRANSITION')
  })

  it('does not let two executors own one run and permits takeover after expiry', async () => {
    const { researchRunRepo } = await loadRepositories()
    const run = createRun(researchRunRepo)

    expect(researchRunRepo.acquireLease(run.id, 'worker-a', 10_000, 1_000)).toBe(true)
    expect(researchRunRepo.acquireLease(run.id, 'worker-b', 10_000, 1_001)).toBe(false)
    expect(researchRunRepo.acquireLease(run.id, 'worker-b', 10_000, 11_001)).toBe(true)
  })

  it('keeps sources and snapshots immutable, evidence idempotent, and citation ordinals stable', async () => {
    const {
      researchRunRepo,
      researchQuestionRepo,
      researchSourceRepo,
      researchEvidenceRepo,
      researchReportRepo,
    } = await loadRepositories()
    const run = createRun(researchRunRepo)
    const question = researchQuestionRepo.create({
      runId: run.id,
      ordinal: 1,
      question: 'How large is the market?',
      intent: 'size',
      requiredEvidenceTypes: ['official-statistics'],
      priority: 'high',
    })
    const source = researchSourceRepo.createSource({
      runId: run.id,
      canonicalUrl: 'https://example.com/report',
      domain: 'example.com',
      title: 'Market report',
      sourceType: 'official-statistics',
      selectionStatus: 'selected',
      scores: { authority: 0.9 },
    })

    expect(() => researchSourceRepo.createSource({
      runId: run.id,
      canonicalUrl: source.canonicalUrl,
      domain: source.domain,
      sourceType: source.sourceType,
      selectionStatus: 'selected',
      scores: {},
    })).toThrow()

    const firstSnapshot = researchSourceRepo.createSnapshot({
      runId: run.id,
      sourceId: source.id,
      contentHash: 'hash-a',
      content: 'Immutable source passage A.',
      metadata: { parser: 'test' },
      fetchedAt: 1_000,
      parserVersion: 'v1',
      finalUrl: source.canonicalUrl,
      idempotencyKey: 'source-1:v1',
    })
    const repeatedSnapshot = researchSourceRepo.createSnapshot({
      runId: run.id,
      sourceId: source.id,
      contentHash: 'hash-b',
      content: 'Attempted mutation.',
      metadata: { parser: 'test' },
      fetchedAt: 2_000,
      parserVersion: 'v2',
      finalUrl: source.canonicalUrl,
      idempotencyKey: 'source-1:v1',
    })

    expect(repeatedSnapshot).toMatchObject({ id: firstSnapshot.id, content: 'Immutable source passage A.' })

    const firstEvidence = researchEvidenceRepo.upsertEvidence({
      runId: run.id,
      questionId: question.id,
      snapshotId: firstSnapshot.id,
      passage: 'The market was measured at 10 billion.',
      summary: 'A primary market-size estimate.',
      stance: 'supporting',
      confidence: 0.9,
      startOffset: 0,
      endOffset: 40,
      idempotencyKey: 'q1:s1:0',
    })
    const repeatedEvidence = researchEvidenceRepo.upsertEvidence({
      runId: run.id,
      questionId: question.id,
      snapshotId: firstSnapshot.id,
      passage: 'A different passage must not replace stored evidence.',
      summary: 'Ignored.',
      stance: 'supporting',
      confidence: 0.1,
      startOffset: 0,
      endOffset: 1,
      idempotencyKey: 'q1:s1:0',
    })
    const secondEvidence = researchEvidenceRepo.upsertEvidence({
      runId: run.id,
      questionId: question.id,
      snapshotId: firstSnapshot.id,
      passage: 'Growth was 12 percent.',
      summary: 'A growth estimate.',
      stance: 'supporting',
      confidence: 0.8,
      startOffset: 41,
      endOffset: 64,
      idempotencyKey: 'q1:s1:1',
    })

    expect(repeatedEvidence).toMatchObject({ id: firstEvidence.id, passage: firstEvidence.passage })

    const section = researchReportRepo.upsertSection({
      runId: run.id,
      ordinal: 1,
      title: 'Market size',
      purpose: 'Present the evidence-backed estimate.',
      status: 'planned',
      idempotencyKey: 'section:market-size',
    })
    const claim = researchReportRepo.upsertClaim({
      runId: run.id,
      sectionId: section.id,
      text: 'The market was measured at 10 billion.',
      kind: 'factual',
      importance: 'high',
      verificationStatus: 'supported',
      confidence: 0.9,
      repairHistory: [],
      idempotencyKey: 'claim:market-size',
    })
    const firstCitation = researchReportRepo.upsertCitation({
      runId: run.id,
      claimId: claim.id,
      evidenceId: firstEvidence.id,
      entailmentStatus: 'supported',
      rationale: 'The passage states the estimate directly.',
    })
    const repeatedCitation = researchReportRepo.upsertCitation({
      runId: run.id,
      claimId: claim.id,
      evidenceId: firstEvidence.id,
      entailmentStatus: 'supported',
      rationale: 'This must preserve the existing ordinal.',
    })
    const secondCitation = researchReportRepo.upsertCitation({
      runId: run.id,
      claimId: claim.id,
      evidenceId: secondEvidence.id,
      entailmentStatus: 'supported',
      rationale: 'The passage states the growth figure directly.',
    })

    expect(repeatedCitation).toMatchObject({ id: firstCitation.id, ordinal: 1 })
    expect(secondCitation.ordinal).toBe(2)
  })

  it('returns aggregate run detail and cascades all child records on deletion', async () => {
    const {
      researchRunRepo,
      researchQuestionRepo,
      researchSourceRepo,
      researchEvidenceRepo,
      researchReportRepo,
      researchEventRepo,
    } = await loadRepositories()
    const run = createRun(researchRunRepo)
    const question = researchQuestionRepo.create({
      runId: run.id,
      ordinal: 1,
      question: 'What evidence exists?',
      intent: 'evidence',
      requiredEvidenceTypes: ['primary-source'],
      priority: 'high',
    })
    const source = researchSourceRepo.createSource({
      runId: run.id,
      canonicalUrl: 'https://example.com/evidence',
      domain: 'example.com',
      sourceType: 'primary-source',
      selectionStatus: 'selected',
      scores: {},
    })
    const snapshot = researchSourceRepo.createSnapshot({
      runId: run.id,
      sourceId: source.id,
      contentHash: 'hash-evidence',
      content: 'Evidence passage.',
      metadata: {},
      fetchedAt: 1_000,
      parserVersion: 'v1',
      finalUrl: source.canonicalUrl,
      idempotencyKey: 'snapshot:evidence',
    })
    const evidence = researchEvidenceRepo.upsertEvidence({
      runId: run.id,
      questionId: question.id,
      snapshotId: snapshot.id,
      passage: 'Evidence passage.',
      summary: 'Evidence summary.',
      stance: 'supporting',
      confidence: 0.8,
      startOffset: 0,
      endOffset: 17,
      idempotencyKey: 'evidence:1',
    })
    const section = researchReportRepo.upsertSection({
      runId: run.id,
      ordinal: 1,
      title: 'Findings',
      purpose: 'Report evidence.',
      status: 'verified',
      idempotencyKey: 'section:findings',
    })
    const claim = researchReportRepo.upsertClaim({
      runId: run.id,
      sectionId: section.id,
      text: 'Evidence exists.',
      kind: 'factual',
      importance: 'high',
      verificationStatus: 'supported',
      confidence: 0.8,
      repairHistory: [],
      idempotencyKey: 'claim:evidence',
    })
    researchReportRepo.upsertCitation({
      runId: run.id,
      claimId: claim.id,
      evidenceId: evidence.id,
      entailmentStatus: 'supported',
      rationale: 'Direct evidence.',
    })
    researchReportRepo.upsertArtifact({
      runId: run.id,
      type: 'report_markdown',
      fileName: 'report.md',
      contentType: 'text/markdown',
      storagePath: 'deepresearch/report.md',
      sizeBytes: 20,
      idempotencyKey: 'artifact:report',
    })
    researchEventRepo.append({
      runId: run.id,
      type: 'research.run.created',
      phase: 'queued',
      payload: { id: run.id },
    })

    const detail = researchRunRepo.getDetail(run.id)
    expect(detail).toMatchObject({ id: run.id })
    expect(detail?.questions).toHaveLength(1)
    expect(detail?.sources).toHaveLength(1)
    expect(detail?.snapshots).toHaveLength(1)
    expect(detail?.evidence).toHaveLength(1)
    expect(detail?.report?.sections).toHaveLength(1)
    expect(detail?.report?.claims).toHaveLength(1)
    expect(detail?.report?.citations).toHaveLength(1)
    expect(detail?.artifacts).toHaveLength(1)
    expect(detail?.events).toHaveLength(1)

    researchRunRepo.delete(run.id)

    expect(researchRunRepo.getDetail(run.id)).toBeUndefined()
    expect(researchQuestionRepo.list(run.id)).toEqual([])
    expect(researchSourceRepo.listSources(run.id)).toEqual([])
    expect(researchSourceRepo.listSnapshots(run.id)).toEqual([])
    expect(researchEvidenceRepo.list(run.id)).toEqual([])
    expect(researchReportRepo.listSections(run.id)).toEqual([])
    expect(researchEventRepo.list(run.id)).toEqual([])
  })
})
