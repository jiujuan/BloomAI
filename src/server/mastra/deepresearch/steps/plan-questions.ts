import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { getResearchProfilePolicy } from '@server/deepresearch/domain/profiles'
import type { DeepResearchRepositories } from '../workflow-context'
import { loadRunnableRun } from '../workflow-context'

const inputSchema = z.object({ runId: z.string().min(1), brief: z.object({ title: z.string(), objective: z.string().nullable(), audience: z.string().nullable(), scope: z.string(), assumptions: z.array(z.string()), plannedSections: z.array(z.string()), criticalClarificationIds: z.array(z.string()) }) })

export function createPlanQuestionsStep(repositories: DeepResearchRepositories) {
  return createStep({
    id: 'deep-research-plan-questions',
    inputSchema,
    outputSchema: inputSchema,
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['planning'])
      const existing = repositories.researchQuestionRepo.list(run.id)
      if (existing.length === 0) {
        const policy = getResearchProfilePolicy(run.profile)
        const remaining = Math.max(0, run.budget.maxQuestions - run.usage.questions)
        const created = policy.questionCategories.slice(0, remaining).map((category, index) => repositories.researchQuestionRepo.create({
          runId: run.id,
          ordinal: index + 1,
          question: run.topic + ': ' + category,
          intent: category,
          requiredEvidenceTypes: [...policy.preferredSourceTypes],
          priority: index < 2 ? 'high' : 'medium',
          status: 'planned',
        }))
        repositories.researchRunRepo.setUsage(run.id, { ...run.usage, questions: run.usage.questions + created.length })
        repositories.researchEventRepo.append({ runId: run.id, type: 'research.questions.planned', phase: 'planning', payload: { questionIds: created.map((question) => question.id), count: created.length } })
      }
      return inputData
    },
  })
}
