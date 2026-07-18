import { describe, expect, it, vi } from 'vitest'
import type {
  ResearchEvidenceDto,
  ResearchQuestionDto,
  ResearchRunDto,
  ResearchSourceDto,
  ResearchSourceSnapshotDto,
} from '@shared/deepresearch/contracts'
import { EvidenceService, type EvidenceAnalyst } from './evidence-service'
import { createDeterministicEvidenceAnalyst } from '@server/mastra/deepresearch/agents/evidence-analyst'
import { createDeterministicGapAnalyst } from '@server/mastra/deepresearch/agents/gap-analyst'
import { shouldStopGapFill } from '@server/mastra/deepresearch/steps/gap-fill-iteration'

const run: ResearchRunDto = {
  id: 'run-1',
  sessionId: null,
  topic: 'Enterprise AI assistants',
  profile: 'market',
  depth: 'deep',
  status: 'researching',
  phase: 'evidence',
  progress: 50,
  brief: null,
  workflowRunId: null,
  budget: {
    maxQuestions: 14,
    maxIterations: 3,
    maxSearchQueries: 48,
    maxNormalizedSources: 50,
    maxFetchedSources: 36,
    searchConcurrency: 6,
    fetchConcurrency: 5,
    maxDurationMs: 30 * 60 * 1000,
  },
  usage: {
    questions: 1,
    iterations: 0,
    searchQueries: 0,
    normalizedSources: 0,
    fetchedSources: 1,
    tokens: 0,
    providerCostUsd: 0,
    startedAt: 0,
    deadlineAt: 30 * 60 * 1000,
  },
  quality: null,
  reportArtifactId: null,
  resumePhase: null,
  error: null,
  createdAt: 0,
  updatedAt: 0,
  completedAt: null,
}

const question: ResearchQuestionDto = {
  id: 'question-1',
  runId: run.id,
  parentQuestionId: null,
  ordinal: 1,
  question: 'How quickly is the market growing?',
  intent: 'growth',
  requiredEvidenceTypes: ['official-statistics'],
  priority: 'high',
  status: 'researching',
  coverage: null,
}

const source: ResearchSourceDto = {
  id: 'source-1',
  runId: run.id,
  canonicalUrl: 'https://example.test/market',
  domain: 'example.test',
  title: 'Official market data',
  author: null,
  publisher: 'Example Institute',
  publishedAt: Date.UTC(2026, 0, 1),
  sourceType: 'official-statistics',
  selectionStatus: 'selected',
  scores: {},
}

const content = [
  '# Market overview',
  'The enterprise AI assistant market grew by twenty percent in the most recent reporting period, according to the official methodology published alongside the dataset.',
  '',
  '## Alternative estimate',
  'A separate audited release reports that comparable revenue growth was lower because it excludes embedded assistant features from the addressable market definition.',
].join('\n')

const snapshot: ResearchSourceSnapshotDto = {
  id: 'snapshot-1',
  runId: run.id,
  sourceId: source.id,
  contentHash: 'hash-1',
  content,
  metadata: {},
  fetchedAt: Date.UTC(2026, 0, 2),
  parserVersion: 'test',
  finalUrl: source.canonicalUrl,
  httpStatus: 200,
}

function createService(analyst: EvidenceAnalyst, clock?: () => number) {
  const evidence: ResearchEvidenceDto[] = []
  const coverage: Array<{ id: string; status: ResearchQuestionDto['status']; value: ResearchQuestionDto['coverage'] }> = []
  const service = new EvidenceService({
    analyst,
    sourceRepo: {
      listSources: () => [source],
      listSnapshots: () => [snapshot],
    },
    evidenceRepo: {
      upsertEvidence: (input) => {
        const existing = evidence.find((item) => item.runId === input.runId && item.questionId === input.questionId && item.snapshotId === input.snapshotId && item.startOffset === input.startOffset && item.endOffset === input.endOffset)
        if (existing) return existing
        const { idempotencyKey: _idempotencyKey, ...record } = input
        const item: ResearchEvidenceDto = { id: 'evidence-' + (evidence.length + 1), ...record }
        evidence.push(item)
        return item
      },
      list: () => evidence,
    },
    clock,
    questionRepo: {
      updateCoverage: (id, data) => {
        coverage.push({ id, status: data.status, value: data.coverage })
        return { ...question, coverage: data.coverage, status: data.status }
      },
    },
  })
  return { service, evidence, coverage }
}

describe('EvidenceService', () => {
  it('creates evidence-specific deterministic summaries for different passages from one source', async () => {
    const analyst = createDeterministicEvidenceAnalyst()
    const packets = [
      { snapshotId: snapshot.id, sourceId: source.id, sourceUrl: source.canonicalUrl, sourceTitle: source.title, sourceType: source.sourceType, domain: source.domain, publishedAt: source.publishedAt, heading: 'Market overview', startOffset: 0, endOffset: 150, text: 'The enterprise AI assistant market grew by twenty percent in the most recent reporting period, according to the official methodology published alongside the dataset.' },
      { snapshotId: snapshot.id, sourceId: source.id, sourceUrl: source.canonicalUrl, sourceTitle: source.title, sourceType: source.sourceType, domain: source.domain, publishedAt: source.publishedAt, heading: 'Alternative estimate', startOffset: 151, endOffset: 320, text: 'A separate audited release reports that comparable revenue growth was lower because it excludes embedded assistant features from the addressable market definition.' },
    ]

    const analyses = await analyst.analyze({ run, questions: [question], packets })

    expect(new Set(analyses.map((item) => item.summary)).size).toBe(2)
    expect(analyses.map((item) => item.summary)).toEqual(expect.arrayContaining([
      expect.stringContaining('twenty percent'),
      expect.stringContaining('audited release'),
    ]))
  })

  it('rejects snippets and emits only bounded evidence packets', async () => {
    const { service, evidence } = createService({
      analyze: async () => [{
        questionId: question.id,
        snapshotId: snapshot.id,
        passage: 'Twenty percent.',
        summary: 'A snippet, not a citable passage.',
        stance: 'supporting',
        confidence: 0.8,
        startOffset: content.indexOf('twenty percent'),
        endOffset: content.indexOf('twenty percent') + 'Twenty percent.'.length,
      }],
    })

    const packets = service.createPackets(run)
    expect(packets).not.toHaveLength(0)
    expect(packets.every((packet) => packet.text.length <= 1_200)).toBe(true)
    expect(packets.every((packet) => packet.endOffset - packet.startOffset <= 1_200)).toBe(true)

    const result = await service.extract(run, [question])
    expect(result.createdCount).toBe(0)
    expect(result.rejectedCount).toBe(1)
    expect(evidence).toEqual([])
  })

  it('persists exact evidence passages linked to one run question and snapshot while retaining contradictions', async () => {
    const supportingStart = content.indexOf('The enterprise AI assistant')
    const supportingEnd = content.indexOf('\n', supportingStart)
    const contradictingStart = content.indexOf('A separate audited release')
    const contradictingEnd = content.length
    const { service, evidence, coverage } = createService({
      analyze: async () => [
        {
          questionId: question.id,
          snapshotId: snapshot.id,
          passage: content.slice(supportingStart, supportingEnd),
          summary: 'The official dataset reports twenty percent growth.',
          stance: 'supporting',
          confidence: 0.9,
          startOffset: supportingStart,
          endOffset: supportingEnd,
        },
        {
          questionId: question.id,
          snapshotId: snapshot.id,
          passage: content.slice(contradictingStart, contradictingEnd),
          summary: 'An alternative market definition produces lower comparable growth.',
          stance: 'contradicting',
          confidence: 0.8,
          startOffset: contradictingStart,
          endOffset: contradictingEnd,
        },
      ],
    })

    const result = await service.extract(run, [question])

    expect(result.createdCount).toBe(2)
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionId: question.id, snapshotId: snapshot.id, stance: 'supporting' }),
      expect.objectContaining({ questionId: question.id, snapshotId: snapshot.id, stance: 'contradicting' }),
    ]))
    expect(evidence.every((item) => item.passage === content.slice(item.startOffset, item.endOffset))).toBe(true)
    expect(coverage).toEqual([expect.objectContaining({
      id: question.id,
      status: 'limited',
      value: expect.objectContaining({
        independentDomainCount: 1,
        evidenceCategories: ['official-statistics'],
        primarySourceCount: 1,
        recentSourceCount: 1,
        supportingEvidenceCount: 1,
        contradictingEvidenceCount: 1,
        hasSingleSourceDependency: true,
        gaps: ['independent sources', 'primary or authoritative source', 'unresolved contradiction'],
      }),
    })])
  })

  it('adapts persisted evidence into a versioned V2 assessment with an injected deterministic clock', async () => {
    const { service } = createService({
      analyze: async () => [{
        questionId: question.id,
        snapshotId: snapshot.id,
        passage: content.slice(0, 150),
        summary: 'The official source supplies a citable market-growth statement.',
        stance: 'supporting',
        confidence: 0.9,
        startOffset: 0,
        endOffset: 150,
      }],
    }, () => Date.UTC(2026, 6, 17))

    await service.extract(run, [question])
    const [assessment] = service.assessCoverageV2(run, [question])

    expect(assessment).toMatchObject({
      policyVersion: 'v2',
      profile: 'market',
      questionId: question.id,
      assessedAt: Date.UTC(2026, 6, 17),
      verdict: 'limited',
    })
    expect(assessment.inputFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(assessment.gaps.map((gap) => gap.code)).toEqual(expect.arrayContaining(['SINGLE_DOMAIN', 'NO_AUTHORITATIVE_SOURCE']))
  })

  it('generates follow-up queries only for high-priority uncovered questions', async () => {
    const analyst = createDeterministicGapAnalyst()
    const uncovered = { ...question, coverage: { questionId: question.id, score: 0.2, independentDomainCount: 1, evidenceCategories: ['official-statistics'], primarySourceCount: 1, recentSourceCount: 1, supportingEvidenceCount: 1, contradictingEvidenceCount: 0, hasSingleSourceDependency: true, gaps: ['independent sources'] } }
    const covered = { ...question, id: 'question-2', priority: 'medium' as const, coverage: { ...uncovered.coverage, questionId: 'question-2', score: 0.1 } }

    await expect(analyst.plan(run, [uncovered, covered])).resolves.toEqual([
      expect.objectContaining({ questionId: question.id }),
    ])
  })

  it('stops the bounded gap loop only after a persisted stop decision, not merely because no evidence was added', () => {
    const state = { coverageComplete: false, marginalNewEvidenceCount: 0, cancelled: false, iterations: 0, maxIterations: run.budget.maxIterations }

    expect(shouldStopGapFill(state)).toBe(false)
    expect(shouldStopGapFill({ ...state, stopDecision: 'stop_no_material_gain' })).toBe(true)
  })
  it('does not persist evidence or coverage when an aborted analyst returns after extraction cancellation', async () => {
    const controller = new AbortController()
    const passage = 'The enterprise AI assistant market grew by twenty percent in the most recent reporting period, according to the official methodology published alongside the dataset.'
    const startOffset = content.indexOf(passage)
    const analyst: EvidenceAnalyst = {
      analyze: vi.fn(async (_input, options) => {
        expect(options?.signal).toBe(controller.signal)
        controller.abort()
        return [{
          questionId: question.id,
          snapshotId: snapshot.id,
          passage,
          summary: 'The source reports twenty percent growth using a published methodology.',
          stance: 'supporting' as const,
          confidence: 0.9,
          startOffset,
          endOffset: startOffset + passage.length,
        }]
      }),
    }
    const { service, evidence, coverage } = createService(analyst)

    await expect(service.extract(run, [question], { signal: controller.signal })).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })

    expect(analyst.analyze).toHaveBeenCalledTimes(1)
    expect(evidence).toHaveLength(0)
    expect(coverage).toHaveLength(0)
  })
})
