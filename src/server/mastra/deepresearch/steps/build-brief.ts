import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import type { ResearchBriefDto } from '@shared/deepresearch/contracts'
import { clarificationSchema } from '@shared/deepresearch/schemas'
import type { BriefPlan, BriefPlanner } from '../agents/brief-planner'
import type { DeepResearchRepositories } from '../workflow-context'
import { checkpointWorkflowPhase, isReplayPastPhase } from './checkpoint-replay'
import { loadRunnableRun } from '../workflow-context'

const runInputSchema = z.object({ runId: z.string().min(1) })
const clarificationPlanSchema = z.object({
  question: z.string().trim().min(1),
  intent: z.string().trim().min(1),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  requiredEvidenceTypes: z.array(z.string().trim().min(1)),
})
const briefPlanSchema = z.object({
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1).nullable(),
  audience: z.string().trim().min(1).nullable(),
  scope: z.string().trim().min(1),
  assumptions: z.array(z.string().trim().min(1)),
  plannedSections: z.array(z.string().trim().min(1)).min(1),
  criticalClarifications: z.array(clarificationPlanSchema),
})
const briefOutputSchema = z.object({
  runId: z.string().min(1),
  brief: z.object({
    title: z.string(),
    objective: z.string().nullable(),
    audience: z.string().nullable(),
    scope: z.string(),
    assumptions: z.array(z.string()),
    plannedSections: z.array(z.string()),
    criticalClarificationIds: z.array(z.string()),
  }),
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
    assumptions: parsed.assumptions,
    plannedSections: parsed.plannedSections,
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
        return { runId: run.id, brief: run.brief }
      }

      const plan = briefPlanSchema.parse(await planner.plan(run))
      const criticalClarificationIds = plan.criticalClarifications.map((clarification, index) => repositories.researchQuestionRepo.create({
        runId: run.id,
        ordinal: index + 1,
        question: clarification.question,
        intent: clarification.intent,
        requiredEvidenceTypes: clarification.requiredEvidenceTypes,
        priority: clarification.priority,
        status: 'planned',
      }).id)
      const brief = toBrief(plan, criticalClarificationIds)
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
