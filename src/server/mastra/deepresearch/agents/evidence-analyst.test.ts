import { describe, expect, it } from 'vitest'
import type { ResearchQuestionDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import type { EvidencePacket } from '@server/services/deepresearch/evidence-service'
import { createDeterministicEvidenceAnalyst } from './evidence-analyst'

const run: ResearchRunDto = {
  id: 'run-1', sessionId: null, topic: 'Enterprise AI assistant market growth', profile: 'market', depth: 'deep',
  status: 'researching', phase: 'evidence', progress: 50, brief: null, workflowRunId: null,
  budget: { maxQuestions: 10, maxIterations: 3, maxSearchQueries: 20, maxNormalizedSources: 20, maxFetchedSources: 20, searchConcurrency: 2, fetchConcurrency: 2, maxDurationMs: 60_000 },
  usage: { questions: 1, iterations: 0, searchQueries: 0, normalizedSources: 0, fetchedSources: 0, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
  quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 0, updatedAt: 0, completedAt: null,
}

const question: ResearchQuestionDto = {
  id: 'question-growth', runId: run.id, parentQuestionId: null, ordinal: 1,
  question: 'What evidence shows enterprise AI assistant market growth and its limitations?', intent: 'market_data',
  requiredEvidenceTypes: ['official-statistics'], sourceTargets: ['official-statistics', 'research.example'],
  needQuantitativeEvidence: true, priority: 'high', status: 'researching', coverage: null,
}

function packet(overrides: Partial<EvidencePacket> & Pick<EvidencePacket, 'snapshotId' | 'sourceId' | 'domain' | 'text'>): EvidencePacket {
  return {
    sourceUrl: `https://${overrides.domain}/article`, sourceTitle: overrides.domain, sourceType: 'news_secondary', publishedAt: Date.UTC(2026, 0, 1),
    heading: null, startOffset: 0, endOffset: overrides.text.length, ...overrides,
  }
}

describe('createDeterministicEvidenceAnalyst', () => {
  it('routes and ranks relevant packets, emits complementary multi-passage evidence, and classifies source assertions', async () => {
    const irrelevant = 'The company held a charity event with local volunteers and announced a new office building for its staff and visitors.'
    const officialFact = 'The official 2025 dataset reports that enterprise AI assistant revenue grew 24 percent year over year, with the reporting methodology published alongside the release.'
    const officialMethod = 'The dataset excludes embedded assistant features, so the reported market-growth figure should not be compared directly with broader software automation estimates.'
    const independentAnalysis = 'Independent researchers estimate that enterprise AI assistant spending increased in 2025, although their estimate remains sensitive to how shared platform revenue is allocated.'
    const vendorClaim = 'We believe our enterprise AI assistant delivers the fastest market-leading return on investment for every sales team, although customers may see different outcomes.'
    const associationSurvey = 'The industry association survey found enterprise AI assistant adoption expanded across regulated industries in 2025, while respondents cited governance and integration limits.'

    const inputPackets = [
      packet({ snapshotId: 'snapshot-irrelevant', sourceId: 'source-irrelevant', domain: 'unrelated.example', text: irrelevant }),
      packet({ snapshotId: 'snapshot-official', sourceId: 'source-official', domain: 'statistics.example', sourceType: 'official-statistics', text: officialFact }),
      packet({ snapshotId: 'snapshot-official', sourceId: 'source-official', domain: 'statistics.example', sourceType: 'official-statistics', startOffset: officialFact.length + 2, endOffset: officialFact.length + 2 + officialMethod.length, text: officialMethod }),
      packet({ snapshotId: 'snapshot-independent', sourceId: 'source-independent', domain: 'research.example', sourceType: 'research_firm', text: independentAnalysis }),
      packet({ snapshotId: 'snapshot-vendor', sourceId: 'source-vendor', domain: 'vendor.example', sourceType: 'company_official', text: vendorClaim }),
      packet({ snapshotId: 'snapshot-association', sourceId: 'source-association', domain: 'association.example', sourceType: 'industry_association', text: associationSurvey }),
    ]
    const analyses = await createDeterministicEvidenceAnalyst().analyze({ run, questions: [question], packets: inputPackets })

    expect(analyses).toHaveLength(5)
    expect(analyses).not.toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: 'source-irrelevant' })]))
    expect(analyses.filter((item) => item.sourceId === 'source-official')).toHaveLength(2)
    expect(new Set(analyses.map((item) => item.sourceId))).toEqual(new Set(['source-official', 'source-independent', 'source-vendor', 'source-association']))
    expect(analyses).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceType: 'fact', numbers: expect.arrayContaining([expect.objectContaining({ value: '24' })]), timeframe: '2025' }),
      expect.objectContaining({ sourceId: 'source-independent', evidenceType: 'analysis', relevance: expect.any(Number), confidence: expect.any(Number) }),
      expect.objectContaining({ sourceId: 'source-vendor', evidenceType: 'marketing_claim', stance: 'contextual' }),
    ]))
    expect(analyses.every((item) => item.passage.length >= 80 && item.endOffset - item.startOffset === item.passage.length)).toBe(true)
  })
})
