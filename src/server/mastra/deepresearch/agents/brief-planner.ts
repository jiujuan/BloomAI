import { Agent } from '@mastra/core/agent'
import type { ResearchRunDto } from '@shared/deepresearch/contracts'
import { getResearchProfilePolicy } from '@server/deepresearch/domain/profiles'
import { throwIfCancellationRequested } from '@server/deepresearch/domain/cancellation'
import { resolveMastraModel } from '../../model-resolver'

export interface BriefClarificationPlan {
  question: string
  intent: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  requiredEvidenceTypes: string[]
}

export interface BriefPlan {
  title: string
  objective: string | null
  audience: string | null
  scope: string
  assumptions: string[]
  plannedSections: string[]
  criticalClarifications: BriefClarificationPlan[]
}

export interface BriefPlanner {
  plan(run: ResearchRunDto, options?: { signal?: AbortSignal }): Promise<BriefPlan>
}

/**
 * Registered now so later planning can use a model without widening the runtime
 * to the chat agent registry. The skeleton workflow injects a deterministic
 * planner by default until the model-backed planner is introduced.
 */
export const briefPlannerAgent = new Agent({
  id: 'deep-research-brief-planner',
  name: 'BloomAI Deep Research Brief Planner',
  instructions: [
    'Create an objective research brief for the supplied topic.',
    'Return structured scope, assumptions, planned sections, and only critical clarification questions.',
  ].join(' '),
  model: ({ requestContext }) => resolveMastraModel(requestContext?.get('model') as string | undefined),
})

export function createDeterministicBriefPlanner(): BriefPlanner {
  return {
    async plan(run: ResearchRunDto, options = {}): Promise<BriefPlan> {
      throwIfCancellationRequested(options)
      const policy = getResearchProfilePolicy(run.profile)
      const plan = {
        title: run.topic,
        objective: run.topic,
        audience: null,
        scope: run.topic,
        assumptions: ['The research is limited to sources available through configured capabilities.'],
        plannedSections: [...policy.requiredSections],
        criticalClarifications: [],
      }
      throwIfCancellationRequested(options)
      return plan
    },
  }
}
