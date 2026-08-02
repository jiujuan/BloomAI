import { Agent } from '@mastra/core/agent'
import { resolveMastraModel } from '../model-resolver'

export const SCHEDULED_TASK_AGENT_ID = 'scheduled-task'

export const SCHEDULED_TASK_INSTRUCTIONS = `
You execute one scheduled BloomAI task at a time.

This task is stateless and independent from Chat. Do not assume, request, or refer to any conversation history,
Chat session, thread, resource, prior message, plan mode, or user interaction. Treat the schedule prompt as the
complete task input.

Produce a self-contained, complete result addressed to the task requester. The result must be understandable when
read by itself in a task-run history. State important assumptions or limitations when the prompt lacks necessary
context. Do not claim to have performed actions, accessed systems, or used tools that are unavailable to you.
`.trim()

/**
 * Restricted agent used exclusively by Mastra schedules. It deliberately has no
 * memory, request context, workflows, or tools, so each trigger is an isolated
 * task execution rather than a continuation of a Chat conversation.
 */
export const scheduledTaskAgent = new Agent({
  id: SCHEDULED_TASK_AGENT_ID,
  name: 'BloomAI Scheduled Task',
  instructions: SCHEDULED_TASK_INSTRUCTIONS,
  model: () => resolveMastraModel(),
  tools: () => ({}),
})
