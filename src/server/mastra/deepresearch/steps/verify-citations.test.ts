import { describe, expect, it, vi } from 'vitest'
import type { ResearchClaimDto, ResearchCitationDto, ResearchEvidenceDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import { createVerifyCitationsStep } from './verify-citations'

const run: ResearchRunDto = {
  id: 'run-citation-unavailable', sessionId: null, topic: 'Citation verification', profile: 'general', depth: 'standard',
  status: 'synthesizing', phase: 'synthesizing', progress: 80, brief: null, workflowRunId: null,
  budget: { maxQuestions: 5, maxIterations: 2, maxSearchQueries: 10, maxNormalizedSources: 10, maxFetchedSources: 10, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 60_000 },
  usage: { questions: 1, iterations: 1, searchQueries: 1, normalizedSources: 1, fetchedSources: 1, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
  quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 1, updatedAt: 1, completedAt: null,
}

const claim: ResearchClaimDto = {
  id: 'claim-1', runId: run.id, sectionId: 'section-1', text: 'Acme grew in 2025.', kind: 'factual', importance: 'high', verificationStatus: 'not_applicable', confidence: 0.8, repairHistory: [],
}
const citation: ResearchCitationDto = {
  id: 'citation-1', runId: run.id, claimId: claim.id, evidenceId: 'evidence-1', entailmentStatus: 'partially_supported', rationale: 'Pending verification.', ordinal: 1,
}
const evidence: ResearchEvidenceDto = {
  id: 'evidence-1', runId: run.id, questionId: 'question-1', snapshotId: 'snapshot-1', passage: 'Acme grew in 2025.', summary: 'Acme grew in 2025.', stance: 'supporting', confidence: 0.8, startOffset: 0, endOffset: 18,
}

describe('verify citations step', () => {
  it('persists a conservative unavailable result instead of accepting an unverifiable claim', async () => {
    const citationUpdates: Array<Record<string, unknown>> = []
    const claimUpdates: Array<Record<string, unknown>> = []
    const events: Array<Record<string, unknown>> = []
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run), transitionWithEvent: vi.fn() },
      researchReportRepo: {
        listClaims: vi.fn(() => [claim]), listCitations: vi.fn(() => [citation]),
        updateCitation: vi.fn((id: string, data: Record<string, unknown>) => { citationUpdates.push({ id, ...data }); return { ...citation, ...data } }),
        updateClaim: vi.fn((id: string, data: Record<string, unknown>) => { claimUpdates.push({ id, ...data }); return { ...claim, ...data } }),
      },
      researchEvidenceRepo: { list: vi.fn(() => [evidence]) },
      researchEventRepo: { append: vi.fn((event: Record<string, unknown>) => events.push(event)) },
      researchAttemptRepo: { get: vi.fn(() => undefined) },
    } as any
    const step = createVerifyCitationsStep({
      repositories,
      verifier: { verify: vi.fn(async () => { throw Object.assign(new Error('provider unavailable'), { code: 'ECONNRESET' }) }) },
    })

    await expect((step as any).execute({ inputData: { runId: run.id } })).resolves.toEqual({ runId: run.id })
    expect(citationUpdates).toEqual(expect.arrayContaining([expect.objectContaining({
      id: citation.id, entailmentStatus: 'unsupported', verificationMethod: 'unavailable',
      semanticChecks: { entity: 'unclear', numericTemporal: 'unclear', relationship: 'unclear', stance: 'unclear' },
    })]))
    expect(claimUpdates).toEqual(expect.arrayContaining([expect.objectContaining({ id: claim.id, verificationStatus: 'unsupported' })]))
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'research.citation.verification_unavailable' })]))
  })
})
