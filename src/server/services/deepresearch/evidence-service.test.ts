import { describe, expect, it, vi } from 'vitest'
import type {
  ResearchEvidenceDto,
  ResearchQuestionDto,
  ResearchRunDto,
  ResearchSourceDto,
  ResearchSourceSnapshotDto,
  ResearchSearchQueryDto,
} from '@shared/deepresearch/contracts'
import { EvidenceService, createSnapshotPackets, type EvidenceAnalyst } from './evidence-service'
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

function createService(
  analyst: EvidenceAnalyst,
  clock?: () => number,
  fixtures: {
    sources: ResearchSourceDto[]
    snapshots: ResearchSourceSnapshotDto[]
    queries?: ResearchSearchQueryDto[]
  } = { sources: [source], snapshots: [snapshot] },
) {
  const evidence: ResearchEvidenceDto[] = []
  const coverage: Array<{ id: string; status: ResearchQuestionDto['status']; value: ResearchQuestionDto['coverage'] }> = []
  const service = new EvidenceService({
    analyst,
    sourceRepo: {
      listSources: () => fixtures.sources,
      listSnapshots: () => fixtures.snapshots,
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
      listSearchQueries: () => fixtures.queries ?? [],
      updateCoverage: (id, data) => {
        coverage.push({ id, status: data.status, value: data.coverage })
        return { ...question, coverage: data.coverage, status: data.status }
      },
    },
  })
  return { service, evidence, coverage }
}

describe('EvidenceService', () => {

  it('respects persisted main-content paragraph offsets when building evidence packets', () => {
    const paragraphOne = 'The first paragraph states a traceable market finding with enough detail for an evidence review.'
    const paragraphTwo = 'The second paragraph records an independently stated limitation so the evidence analyst can cite it precisely.'
    const paragraphThree = 'The third paragraph provides a follow-up observation that should start a fresh packet instead of splitting a paragraph.'
    const paragraphContent = [paragraphOne, paragraphTwo, paragraphThree].join('\n\n')
    const paragraphSnapshot: ResearchSourceSnapshotDto = {
      ...snapshot,
      content: paragraphContent,
      metadata: {
        paragraphs: [
          { ordinal: 0, startOffset: 0, endOffset: paragraphOne.length },
          { ordinal: 1, startOffset: paragraphOne.length + 2, endOffset: paragraphOne.length + 2 + paragraphTwo.length },
          { ordinal: 2, startOffset: paragraphOne.length + paragraphTwo.length + 4, endOffset: paragraphContent.length },
        ],
        offsetUnit: 'utf16_code_unit',
      },
    }

    const packets = createSnapshotPackets(paragraphSnapshot, source, paragraphOne.length + paragraphTwo.length + 3)

    expect(packets).toHaveLength(2)
    expect(packets.map((packet) => [packet.startOffset, packet.endOffset])).toEqual([
      [0, paragraphOne.length + paragraphTwo.length + 2],
      [paragraphOne.length + paragraphTwo.length + 4, paragraphContent.length],
    ])
    expect(packets.every((packet) => packet.text === paragraphContent.slice(packet.startOffset, packet.endOffset))).toBe(true)
  })

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


  it('persists structured evidence fields from a traceable exact passage', async () => {
    const passage = content.slice(content.indexOf('The enterprise AI assistant'), content.indexOf('\n', content.indexOf('The enterprise AI assistant')))
    const startOffset = content.indexOf(passage)
    const { service, evidence } = createService({
      analyze: async () => [{
        questionId: question.id,
        sourceId: source.id,
        snapshotId: snapshot.id,
        passage,
        summary: 'The enterprise AI assistant market grew by twenty percent in the most recent reporting period.',
        claim: 'The market grew by twenty percent in the most recent reporting period.',
        evidenceType: 'fact',
        entities: ['Enterprise AI'],
        numbers: [{ value: 'twenty', unit: 'percent', context: 'market growth' }],
        timeframe: 'most recent reporting period',
        stance: 'supporting',
        relevance: 0.9,
        confidence: 0.9,
        startOffset,
        endOffset: startOffset + passage.length,
      }],
    })

    await expect(service.extract(run, [question])).resolves.toMatchObject({ createdCount: 1, rejectedCount: 0 })
    expect(evidence).toEqual([expect.objectContaining({
      questionId: question.id,
      sourceId: source.id,
      snapshotId: snapshot.id,
      passage,
      claim: 'The market grew by twenty percent in the most recent reporting period.',
      evidenceType: 'fact',
      entities: ['Enterprise AI'],
      numbers: [{ value: 'twenty', unit: 'percent', context: 'market growth' }],
      timeframe: 'most recent reporting period',
      relevance: expect.any(Number),
      confidence: 0.9,
      startOffset,
      endOffset: startOffset + passage.length,
    })])
  })

  it('rejects exact but irrelevant source passages for the target question', async () => {
    const irrelevantPassage = 'The institute relocated its archival collection to a new climate-controlled building and expanded weekday access for visiting historians.'
    const irrelevantSnapshot: ResearchSourceSnapshotDto = { ...snapshot, content: irrelevantPassage }
    const { service, evidence } = createService({
      analyze: async () => [{
        questionId: question.id,
        snapshotId: irrelevantSnapshot.id,
        passage: irrelevantPassage,
        summary: 'The institute expanded archival access for historians.',
        stance: 'contextual',
        confidence: 0.8,
        startOffset: 0,
        endOffset: irrelevantPassage.length,
      }],
    }, undefined, { sources: [source], snapshots: [irrelevantSnapshot] })

    await expect(service.extract(run, [question])).resolves.toMatchObject({ createdCount: 0, rejectedCount: 0 })
    expect(evidence).toEqual([])
  })

  it('labels vendor self-promotion as a marketing claim instead of a market fact', async () => {
    const vendorSource: ResearchSourceDto = {
      ...source,
      id: 'source-vendor',
      sourceType: 'company_official',
      canonicalUrl: 'https://vendor.example.test/platform',
    }
    const vendorPassage = 'Our market-leading enterprise AI assistant platform delivers the fastest research workflows for revenue teams evaluating market growth opportunities.'
    const vendorSnapshot: ResearchSourceSnapshotDto = {
      ...snapshot,
      id: 'snapshot-vendor',
      sourceId: vendorSource.id,
      content: vendorPassage,
      finalUrl: vendorSource.canonicalUrl,
    }
    const { service, evidence } = createService({
      analyze: async () => [{
        questionId: question.id,
        snapshotId: vendorSnapshot.id,
        passage: vendorPassage,
        summary: 'The vendor presents its platform as market-leading for research workflows.',
        evidenceType: 'fact',
        stance: 'supporting',
        confidence: 0.85,
        startOffset: 0,
        endOffset: vendorPassage.length,
      }],
    }, undefined, { sources: [vendorSource], snapshots: [vendorSnapshot] })

    await service.extract(run, [question])
    expect(evidence).toEqual([expect.objectContaining({ evidenceType: 'marketing_claim', stance: 'contextual' })])
  })

  it('requires supported numbers and a timeframe for high-priority quantitative evidence', async () => {
    const numericPassage = 'The enterprise AI assistant market grew 20 percent in 2025, according to the official methodology published alongside the dataset.'
    const numericSnapshot: ResearchSourceSnapshotDto = { ...snapshot, content: numericPassage }
    const { service, evidence } = createService({
      analyze: async () => [{
        questionId: question.id,
        snapshotId: numericSnapshot.id,
        passage: numericPassage,
        summary: 'The source reports 20 percent market growth.',
        evidenceType: 'fact',
        stance: 'supporting',
        confidence: 0.9,
        startOffset: 0,
        endOffset: numericPassage.length,
      }],
    }, undefined, { sources: [source], snapshots: [numericSnapshot] })

    await expect(service.extract(run, [question])).resolves.toMatchObject({ createdCount: 0, rejectedCount: 1 })
    expect(evidence).toEqual([])
  })

  it('drops fabricated structured metadata while retaining only passage-grounded values', async () => {
    const numericPassage = 'The enterprise AI assistant market grew 20 percent in 2025, according to the official methodology published alongside the dataset.'
    const numericSnapshot: ResearchSourceSnapshotDto = { ...snapshot, content: numericPassage }
    const { service, evidence } = createService({
      analyze: async () => [{
        questionId: question.id,
        snapshotId: numericSnapshot.id,
        passage: numericPassage,
        summary: 'The market will grow 999 percent after 2030.',
        claim: 'Fabricated context proves a 999 percent increase.',
        evidenceType: 'fact',
        entities: ['Fabricated Company'],
        numbers: [
          { value: '20', unit: 'percent', context: 'market grew 20 percent' },
          { value: '999', unit: 'percent', context: 'fabricated context' },
        ],
        timeframe: '2025',
        stance: 'supporting',
        confidence: 0.9,
        startOffset: 0,
        endOffset: numericPassage.length,
      }],
    }, undefined, { sources: [source], snapshots: [numericSnapshot] })

    await expect(service.extract(run, [question])).resolves.toMatchObject({ createdCount: 1, rejectedCount: 0 })
    expect(evidence).toEqual([expect.objectContaining({
      summary: numericPassage,
      claim: numericPassage,
      entities: [],
      numbers: [{ value: '20', unit: 'percent', context: 'market grew 20 percent' }],
      timeframe: '2025',
    })])
  })

  it('deduplicates repeated passages while keeping a distinct independent source', async () => {
    const repeatedPassage = 'The enterprise AI assistant market growth outlook attributes stronger demand to wider adoption of automated research tools across revenue teams.'
    const independentPassage = 'Independent market research finds revenue teams are increasing spending on assistant tools as account planning and prospect research become automated.'
    const sourceTwo: ResearchSourceDto = { ...source, id: 'source-2', canonicalUrl: 'https://second.example.test/market', domain: 'second.example.test' }
    const sourceThree: ResearchSourceDto = { ...source, id: 'source-3', canonicalUrl: 'https://third.example.test/market', domain: 'third.example.test' }
    const snapshotOne: ResearchSourceSnapshotDto = { ...snapshot, id: 'snapshot-one', sourceId: source.id, content: repeatedPassage }
    const snapshotTwo: ResearchSourceSnapshotDto = { ...snapshot, id: 'snapshot-two', sourceId: sourceTwo.id, content: repeatedPassage, finalUrl: sourceTwo.canonicalUrl }
    const snapshotThree: ResearchSourceSnapshotDto = { ...snapshot, id: 'snapshot-three', sourceId: sourceThree.id, content: independentPassage, finalUrl: sourceThree.canonicalUrl }
    const { service, evidence } = createService({
      analyze: async () => [snapshotOne, snapshotTwo, snapshotThree].map((candidateSnapshot) => ({
        questionId: question.id,
        snapshotId: candidateSnapshot.id,
        passage: candidateSnapshot.content,
        summary: candidateSnapshot.content,
        evidenceType: 'fact' as const,
        stance: 'supporting' as const,
        confidence: 0.9,
        startOffset: 0,
        endOffset: candidateSnapshot.content.length,
      })),
    }, undefined, { sources: [source, sourceTwo, sourceThree], snapshots: [snapshotOne, snapshotTwo, snapshotThree] })

    await expect(service.extract(run, [question])).resolves.toMatchObject({ createdCount: 2, rejectedCount: 1 })
    expect(evidence.map((item) => item.sourceId).sort()).toEqual([source.id, sourceThree.id].sort())
  })

  it('rejects evidence returned for a different active question even when the snapshot is valid', async () => {
    const definitionQuestion: ResearchQuestionDto = { ...question, id: 'question-definition', question: 'What is the market definition?', intent: 'definition' }
    const definitionSource: ResearchSourceDto = { ...source, id: 'source-definition', scores: { queryId: 'query-definition' } }
    const definitionPassage = 'The market definition covers software that identifies and prioritizes prospective customers using verified company and buyer signals from multiple data sources.'
    const definitionSnapshot: ResearchSourceSnapshotDto = { ...snapshot, id: 'snapshot-definition', sourceId: definitionSource.id, content: definitionPassage }
    const { service, evidence } = createService({
      analyze: async () => [{
        questionId: question.id,
        snapshotId: definitionSnapshot.id,
        passage: definitionPassage,
        summary: 'The source defines the market through verified company and buyer signals.',
        stance: 'supporting',
        confidence: 0.9,
        startOffset: 0,
        endOffset: definitionPassage.length,
      }],
    }, undefined, {
      sources: [definitionSource],
      snapshots: [definitionSnapshot],
      queries: [{ id: 'query-definition', runId: run.id, questionId: definitionQuestion.id, iteration: 0, query: 'market definition', provider: null, status: 'completed', resultCount: 1, error: null, createdAt: 1, completedAt: 1, candidates: [] }],
    })

    await expect(service.extract(run, [definitionQuestion])).resolves.toMatchObject({ createdCount: 0, rejectedCount: 1 })
    expect(evidence).toEqual([])
  })
  it('routes source packets only to the research question that produced the search query', async () => {
    const definitionQuestion: ResearchQuestionDto = {
      ...question,
      id: 'question-definition',
      ordinal: 1,
      question: 'What is the market definition?',
      intent: 'definition',
    }
    const growthQuestion: ResearchQuestionDto = {
      ...question,
      id: 'question-growth',
      ordinal: 2,
      question: 'What is the market growth rate?',
      intent: 'growth',
    }
    const definitionSource: ResearchSourceDto = {
      ...source,
      id: 'source-definition',
      scores: { queryId: 'query-definition' },
    }
    const growthSource: ResearchSourceDto = {
      ...source,
      id: 'source-growth',
      canonicalUrl: 'https://example.test/growth',
      domain: 'growth.example.test',
      scores: { queryId: 'query-growth' },
    }
    const definitionContent = 'The market definition covers software that identifies and prioritizes prospective customers using verified company and buyer signals from multiple public and private data sources.'
    const growthContent = 'The market growth evidence reports that sales intelligence adoption expanded as revenue teams added automated prospect research to their standard account-planning workflows.'
    const definitionSnapshot: ResearchSourceSnapshotDto = {
      ...snapshot,
      id: 'snapshot-definition',
      sourceId: definitionSource.id,
      content: definitionContent,
      finalUrl: definitionSource.canonicalUrl,
    }
    const growthSnapshot: ResearchSourceSnapshotDto = {
      ...snapshot,
      id: 'snapshot-growth',
      sourceId: growthSource.id,
      content: growthContent,
      finalUrl: growthSource.canonicalUrl,
    }
    const capturedInputs: Array<{ questionId: string; sourceIds: string[] }> = []
    const persisted: ResearchEvidenceDto[] = []
    const analyst: EvidenceAnalyst = {
      analyze: vi.fn(async ({ questions: analyzedQuestions, packets }) => {
        capturedInputs.push({ questionId: analyzedQuestions[0].id, sourceIds: [...new Set(packets.map((packet) => packet.sourceId))] })
        return packets.map((packet) => ({
          questionId: analyzedQuestions[0].id,
          snapshotId: packet.snapshotId,
          passage: packet.text,
          summary: 'A routed source packet supports the assigned research question.',
          stance: 'supporting' as const,
          confidence: 0.9,
          startOffset: packet.startOffset,
          endOffset: packet.endOffset,
        }))
      }),
    }
    const service = new EvidenceService({
      analyst,
      sourceRepo: {
        listSources: () => [definitionSource, growthSource],
        listSnapshots: () => [definitionSnapshot, growthSnapshot],
      },
      evidenceRepo: {
        upsertEvidence: (input) => {
          const existing = persisted.find((item) => item.questionId === input.questionId && item.snapshotId === input.snapshotId && item.startOffset === input.startOffset && item.endOffset === input.endOffset)
          if (existing) return existing
          const { idempotencyKey: _idempotencyKey, ...record } = input
          const item: ResearchEvidenceDto = { id: 'evidence-' + (persisted.length + 1), ...record }
          persisted.push(item)
          return item
        },
        list: () => persisted,
      },
      questionRepo: {
        listSearchQueries: () => [
          { id: 'query-definition', runId: run.id, questionId: definitionQuestion.id, iteration: 0, query: 'definition query', provider: null, status: 'completed', resultCount: 1, error: null, createdAt: 1, completedAt: 1, candidates: [] },
          { id: 'query-growth', runId: run.id, questionId: growthQuestion.id, iteration: 0, query: 'growth query', provider: null, status: 'completed', resultCount: 1, error: null, createdAt: 1, completedAt: 1, candidates: [] },
        ],
        updateCoverage: (id, data) => ({ ...(id === definitionQuestion.id ? definitionQuestion : growthQuestion), coverage: data.coverage, status: data.status }),
      },
    })

    await service.extract(run, [definitionQuestion, growthQuestion])

    expect(capturedInputs).toEqual([
      { questionId: definitionQuestion.id, sourceIds: [definitionSource.id] },
      { questionId: growthQuestion.id, sourceIds: [growthSource.id] },
    ])
    expect(persisted).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionId: definitionQuestion.id, snapshotId: definitionSnapshot.id }),
      expect.objectContaining({ questionId: growthQuestion.id, snapshotId: growthSnapshot.id }),
    ]))
    expect(persisted).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ questionId: definitionQuestion.id, snapshotId: growthSnapshot.id }),
      expect.objectContaining({ questionId: growthQuestion.id, snapshotId: definitionSnapshot.id }),
    ]))
  })


  it('does not broadcast legacy source packets to multiple questions', async () => {
    const secondQuestion: ResearchQuestionDto = { ...question, id: 'question-2', ordinal: 2, intent: 'definition' }
    const analyst: EvidenceAnalyst = { analyze: vi.fn(async () => []) }
    const { service } = createService(analyst)

    await service.extract(run, [question, secondQuestion])

    expect(analyst.analyze).not.toHaveBeenCalled()
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
