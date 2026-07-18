import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { researchBriefSchema } from '@shared/deepresearch/schemas'
import { createTopicBoundQuestionPlans } from '../agents/brief-planner'
import type { DeepResearchRepositories } from '../workflow-context'
import { checkpointWorkflowPhase } from './checkpoint-replay'
import { loadRunnableRun } from '../workflow-context'

const inputSchema = z.object({ runId: z.string().min(1), brief: researchBriefSchema })

export function createPlanQuestionsStep(repositories: DeepResearchRepositories) {
  return createStep({
    id: 'deep-research-plan-questions',
    inputSchema,
    outputSchema: inputSchema,
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['planning'])
      const existing = repositories.researchQuestionRepo.list(run.id)
      const plannedQuestions = existing.filter((question) => question.questionType !== 'clarification')
      if (plannedQuestions.length === 0) {
        const remaining = Math.max(0, run.budget.maxQuestions - run.usage.questions)
        const candidates = inputData.brief.questions?.length ? inputData.brief.questions : createTopicBoundQuestionPlans(run)
        const created = candidates.slice(0, remaining).map((planned, index) => repositories.researchQuestionRepo.create({
          runId: run.id,
          ordinal: existing.length + index + 1,
          question: planned.question,
          intent: planned.intent,
          requiredEvidenceTypes: planned.sourceTargets,
          sectionKey: planned.sectionKey,
          questionType: planned.questionType,
          needPrimarySource: planned.needPrimarySource,
          needRecentSource: planned.needRecentSource,
          needQuantitativeEvidence: planned.needQuantitativeEvidence,
          sourceTargets: planned.sourceTargets,
          priority: planned.priority,
          status: 'planned',
        }))
        repositories.researchRunRepo.setUsage(run.id, { ...run.usage, questions: run.usage.questions + created.length })
        repositories.researchEventRepo.append({ runId: run.id, type: 'research.questions.planned', phase: 'planning', payload: { questionIds: created.map((question) => question.id), count: created.length } })
      }
      checkpointWorkflowPhase(repositories, run, 'plan_questions', 'plan_queries')
      return inputData
    },
  })
}
