import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import type { ResearchBriefDto } from '@shared/deepresearch/contracts'
import { clarificationSchema, researchBriefSchema } from '@shared/deepresearch/schemas'
import type { BriefPlan, BriefPlanner } from '../agents/brief-planner'
import type { DeepResearchRepositories } from '../workflow-context'
import { assertWorkflowNotCancelled, checkpointWorkflowPhase, getWorkflowExecution, isReplayPastPhase } from './checkpoint-replay'
import { loadRunnableRun } from '../workflow-context'

const runInputSchema = z.object({ runId: z.string().min(1) })
const clarificationPlanSchema = z.object({
  question: z.string().trim().min(1),
  intent: z.string().trim().min(1),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  requiredEvidenceTypes: z.array(z.string().trim().min(1)),
})
const briefPlanSchema = researchBriefSchema
  .omit({ criticalClarificationIds: true })
  .extend({ criticalClarifications: z.array(clarificationPlanSchema) })
const briefOutputSchema = z.object({
  runId: z.string().min(1),
  brief: researchBriefSchema,
})
const suspendSchema = z.object({
  runId: z.string().min(1),
  clarificationIds: z.array(z.string().min(1)).min(1),
})

function toBrief(plan: BriefPlan, criticalClarificationIds: string[]): ResearchBriefDto {
  const parsed = briefPlanSchema.parse(plan)
  return {
    title: parsed.title,
    objective: parsed.objective,
    audience: parsed.audience,
    scope: parsed.scope,
    definition: parsed.definition,
    timeframe: parsed.timeframe,
    geography: parsed.geography,
    deliverables: parsed.deliverables,
    assumptions: parsed.assumptions,
    plannedSections: parsed.plannedSections,
    questions: parsed.questions,
    criticalClarificationIds,
  }
}

export function createBuildBriefStep({ repositories, planner }: { repositories: DeepResearchRepositories; planner: BriefPlanner }) {
  return createStep({
    id: 'deep-research-build-brief',
    inputSchema: runInputSchema,
    outputSchema: briefOutputSchema,
    resumeSchema: clarificationSchema,
    suspendSchema,
    execute: async ({ inputData, resumeData, suspend }) => {
      let run = loadRunnableRun(repositories, inputData.runId, ['planning', 'awaiting_input'])

      if (resumeData) {
        const clarification = clarificationSchema.parse(resumeData)
        if (run.status !== 'awaiting_input' || !run.brief?.criticalClarificationIds.includes(clarification.clarificationId)) {
          throw new Error('RESEARCH_CLARIFICATION_REQUIRED: clarification does not match the suspended run.')
        }
        run = repositories.researchRunRepo.transitionWithEvent(run.id, 'planning', {
          phase: 'planning',
          progress: 30,
          resumePhase: null,
        })
      }

      if (run.brief) {
        checkpointWorkflowPhase(repositories, run, 'planning', 'plan_questions')
        return { runId: run.id, brief: researchBriefSchema.parse(run.brief) }
      }

      assertWorkflowNotCancelled(repositories, run.id)
      const plan = briefPlanSchema.parse(await planner.plan(run, { signal: getWorkflowExecution(run.id)?.signal }))
      assertWorkflowNotCancelled(repositories, run.id)
      const criticalClarificationIds = plan.criticalClarifications.map((clarification, index) => repositories.researchQuestionRepo.create({
        runId: run.id,
        ordinal: index + 1,
        question: clarification.question,
        intent: clarification.intent,
        requiredEvidenceTypes: clarification.requiredEvidenceTypes,
        sectionKey: 'scope-and-method',
        questionType: 'clarification',
        sourceTargets: clarification.requiredEvidenceTypes,
        priority: clarification.priority,
        status: 'planned',
      }).id)
      const brief = researchBriefSchema.parse(toBrief(plan, criticalClarificationIds))
      repositories.researchRunRepo.setBrief(run.id, brief)
      repositories.researchEventRepo.append({
        runId: run.id,
        type: 'research.brief.completed',
        phase: 'planning',
        payload: { id: run.id },
      })
      checkpointWorkflowPhase(repositories, run, 'planning', 'plan_questions')

      if (criticalClarificationIds.length > 0) {
        repositories.researchRunRepo.transitionWithEvent(run.id, 'awaiting_input', {
          phase: 'awaiting_clarification',
          progress: 25,
          resumePhase: 'planning',
          eventType: 'research.run.awaiting_input',
          eventPayload: { clarificationIds: criticalClarificationIds },
        })
        return suspend({ runId: run.id, clarificationIds: criticalClarificationIds }, { resumeLabel: 'planning' })
      }

      return { runId: run.id, brief }
    },
  })
}
