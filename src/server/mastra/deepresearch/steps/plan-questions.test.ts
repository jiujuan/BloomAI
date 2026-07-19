import { describe, expect, it, vi } from 'vitest'
import type { ResearchRunDto } from '@shared/deepresearch/contracts'
import { createPlanQuestionsStep } from './plan-questions'

const run: ResearchRunDto = {
  id: 'run-question-plan', sessionId: null, topic: '企业 AI 助手市场', profile: 'market', depth: 'standard', status: 'planning', phase: 'planning', progress: 0, workflowRunId: null,
  brief: null,
  budget: { maxQuestions: 2, maxIterations: 1, maxSearchQueries: 20, maxNormalizedSources: 24, maxFetchedSources: 16, searchConcurrency: 4, fetchConcurrency: 3, maxDurationMs: 60_000 },
  usage: { questions: 0, iterations: 0, searchQueries: 0, normalizedSources: 0, fetchedSources: 0, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
  quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 1, updatedAt: 1, completedAt: null,
}

const question = (index: number) => ({
  question: `子主题 ${index}`,
  intent: 'market analysis',
  priority: 'medium' as const,
  sectionKey: `section-${index}`,
  questionType: 'market-analysis',
  needPrimarySource: false,
  needRecentSource: false,
  needQuantitativeEvidence: false,
  sourceTargets: ['官方资料'],
})

const brief = {
  title: run.topic, objective: null, audience: null, scope: run.topic, assumptions: [], plannedSections: [], criticalClarificationIds: [],
  questions: [question(1), question(2), question(3), question(4)],
}

describe('createPlanQuestionsStep', () => {
  it('caps planned subtopics at the run question budget and records the truncation', async () => {
    const created: any[] = []
    const append = vi.fn()
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run), setUsage: vi.fn() },
      researchQuestionRepo: {
        list: vi.fn(() => []),
        listSearchQueries: vi.fn(() => []),
        create: vi.fn((input) => {
          created.push(input)
          return { id: `question-${created.length}`, ...input }
        }),
      },
      researchEventRepo: { append },
      researchAttemptRepo: { get: vi.fn(() => undefined) },
    } as any

    const step = createPlanQuestionsStep(repositories)
    await (step as any).execute({ inputData: { runId: run.id, brief } })

    expect(created).toHaveLength(2)
    expect(repositories.researchRunRepo.setUsage).toHaveBeenCalledWith(run.id, expect.objectContaining({ questions: 2 }))
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      type: 'research.questions.planned',
      payload: expect.objectContaining({ requestedCount: 4, maxQuestions: 2, truncatedCount: 2 }),
    }))
  })
})
