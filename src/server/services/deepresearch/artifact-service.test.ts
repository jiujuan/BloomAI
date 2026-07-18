import { describe, expect, it } from 'vitest'
import type { ArtifactWriteInput } from './artifact-service'
import { createReportMarkdown } from './artifact-service'

function input(): ArtifactWriteInput {
  return {
    run: {
      id: 'run-1', sessionId: null, topic: 'AI sales intelligence market', profile: 'market', depth: 'standard', status: 'completed', phase: 'report_complete', progress: 100, brief: { title: 'AI sales intelligence market', objective: null, audience: null, scope: 'Global market', assumptions: [], plannedSections: ['market-definition'], criticalClarificationIds: [] }, workflowRunId: null,
      budget: { maxQuestions: 10, maxIterations: 3, maxSearchQueries: 20, maxNormalizedSources: 20, maxFetchedSources: 20, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 60_000 },
      usage: { questions: 1, iterations: 0, searchQueries: 1, normalizedSources: 1, fetchedSources: 1, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
      quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 1, updatedAt: 1, completedAt: 1,
    },
    sections: [{ id: 'section-1', runId: 'run-1', ordinal: 1, title: 'market-definition', purpose: 'Define the market.', draft: 'Market definition.', verifiedText: null, status: 'drafted' }],
    claims: [{ id: 'claim-1', runId: 'run-1', sectionId: 'section-1', text: 'Verified market fact.', kind: 'factual', importance: 'high', verificationStatus: 'supported', confidence: 0.9, repairHistory: [] }],
    citations: [{ id: 'citation-1', runId: 'run-1', claimId: 'claim-1', evidenceId: 'evidence-1', entailmentStatus: 'supported', rationale: 'Direct support.', ordinal: 1 }],
    evidence: [{ id: 'evidence-1', runId: 'run-1', questionId: 'question-1', snapshotId: 'snapshot-1', passage: 'A sufficiently long citable passage supporting the claim in the report.', summary: 'Source supports the claim.', stance: 'supporting', confidence: 0.9, startOffset: 0, endOffset: 68 }],
    sources: [{ id: 'source-1', runId: 'run-1', canonicalUrl: 'https://example.com/research', domain: 'example.com', title: 'Sales intelligence research', author: null, publisher: null, publishedAt: null, sourceType: 'industry-report', selectionStatus: 'selected', scores: {} }],
    snapshots: [{ id: 'snapshot-1', runId: 'run-1', sourceId: 'source-1', contentHash: 'hash', content: 'Snapshot content', metadata: {}, fetchedAt: 1, parserVersion: 'test', finalUrl: 'https://example.com/research', httpStatus: 200 }],
    questions: [{ id: 'question-1', runId: 'run-1', parentQuestionId: null, ordinal: 1, question: 'What is the market?', intent: 'market-definition', requiredEvidenceTypes: [], priority: 'high', status: 'covered', coverage: null }],
    quality: { releaseStatus: 'completed', highPriorityQuestionCoverage: 1, factualClaimCitationCoverage: 1, supportedCitationCoverage: 1, independentCitedDomainCount: 1, contradictionDisclosureCoverage: 1, requiredSectionCoverage: 1, limitations: [], assessorVersion: 'test' },
  }
}

describe('createReportMarkdown', () => {
  it('renders the reference title and source URL rather than an evidence UUID placeholder', () => {
    const markdown = createReportMarkdown(input())

    expect(markdown).toContain('[1] [Sales intelligence research](https://example.com/research)')
    expect(markdown).not.toContain('Evidence evidence-1')
  })

  it('does not expose an evidence identifier when a source cannot be resolved', () => {
    const value = input()
    value.evidence = []
    const markdown = createReportMarkdown(value)

    expect(markdown).toContain('[1] Bound source unavailable.')
    expect(markdown).not.toContain('evidence-1')
  })
})
