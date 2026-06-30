import { Mastra } from '@mastra/core/mastra'
import { chatAgent } from './chat-agent'
import { researchWriterAgent } from './agents/research-writer-agent'
import { researchPlannerAgent } from './agents/research-planner-agent'
import { researchAgent, writerAgent, coderAgent } from './agents/team'
import { deepResearchWorkflow } from './workflows/deep-research'

/**
 * Single Mastra instance for BloomAI chat. Agents + workflows are registered here
 * and served via @mastra/ai-sdk on the Hono server — no `mastra` CLI or generated
 * server is required.
 */
export const mastra = new Mastra({
  agents: {
    chat: chatAgent,
    'research-writer': researchWriterAgent,
    'research-planner': researchPlannerAgent,
    research: researchAgent,
    writer: writerAgent,
    coder: coderAgent,
  },
  workflows: {
    'deep-research': deepResearchWorkflow,
  },
})
