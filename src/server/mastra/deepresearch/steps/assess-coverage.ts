import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { areHighPriorityQuestionsCovered, type EvidenceService } from '@server/services/deepresearch/evidence-service'
import type { DeepResearchRepositories } from '../workflow-context'
import { loadRunnableRun } from '../workflow-context'

const briefSchema = z.object({
  title: z.string(),
  objective: z.string().nullable(),
  audience: z.string().nullable(),
  scope: z.string(),
  assumptions: z.array(z.string()),
  plannedSections: z.array(z.string()),
  criticalClarificationIds: z.array(z.string()),
})
export const gapLoopStateSchema = z.object({
  runId: z.string().min(1),
  brief: briefSchema,
  coverageComplete: z.boolean(),
  marginalNewEvidenceCount: z.number().int().nonnegative(),
  cancelled: z.boolean(),
  iterations: z.number().int().nonnegative(),
  maxIterations: z.number().int().nonnegative(),
})

export function createAssessCoverageStep({ repositories, evidenceService }: { repositories: DeepResearchRepositories; evidenceService: EvidenceService }) {
  return createStep({
    id: 'deep-research-assess-coverage',
    inputSchema: z.object({ runId: z.string().min(1), brief: briefSchema }),
    outputSchema: gapLoopStateSchema,
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['planning'])
      const questions = repositories.researchQuestionRepo.list(run.id)
      const coverage = evidenceService.assessCoverage(run, questions)
      for (const item of coverage) {
        repositories.researchEventRepo.append({
          runId: run.id,
          type: 'research.coverage.assessed',
          phase: 'assessing_coverage',
          payload: { id: item.questionId, score: item.score },
        })
      }
      const updatedQuestions = repositories.researchQuestionRepo.list(run.id)
      return {
        runId: run.id,
        brief: inputData.brief,
        coverageComplete: areHighPriorityQuestionsCovered(updatedQuestions),
        marginalNewEvidenceCount: coverage.length,
        cancelled: repositories.researchRunRepo.get(run.id)?.status === 'cancelled',
        iterations: run.usage.iterations,
        maxIterations: run.budget.maxIterations,
      }
    },
  })
}
