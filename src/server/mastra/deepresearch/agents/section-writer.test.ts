import { describe, expect, it } from 'vitest'
import type { ResearchRunDto, ResearchReportSectionDto } from '@shared/deepresearch/contracts'
import { createDeterministicSectionWriter } from './section-writer'

const run: ResearchRunDto = {
  id: 'run-1', sessionId: null, topic: 'Example topic', profile: 'general', depth: 'standard', status: 'researching', phase: 'drafting_sections', progress: 72, workflowRunId: 'workflow-1',
  brief: { title: 'Example topic', objective: null, audience: null, scope: 'United States, 2026', assumptions: [], plannedSections: [], criticalClarificationIds: [] },
  budget: { maxQuestions: 10, maxIterations: 3, maxSearchQueries: 20, maxNormalizedSources: 20, maxFetchedSources: 20, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 60_000 },
  usage: { questions: 0, iterations: 0, searchQueries: 0, normalizedSources: 0, fetchedSources: 0, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
  quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 1, updatedAt: 1, completedAt: null,
}

function section(title: string): ResearchReportSectionDto {
  return { id: title, runId: run.id, ordinal: 1, title, purpose: 'Required section.', draft: null, verifiedText: null, status: 'planned' }
}

describe('createDeterministicSectionWriter', () => {
  it('writes a scope-and-method section from the saved brief when source evidence is not applicable', async () => {
    await expect(createDeterministicSectionWriter().draft({ run, section: section('scope-and-method'), evidence: [] })).resolves.toContain('United States, 2026')
  })

  it('writes reference guidance instead of reusing an evidence limitation for the references section', async () => {
    await expect(createDeterministicSectionWriter().draft({ run, section: section('references'), evidence: [] })).resolves.toContain('citation section below')
  })
})
