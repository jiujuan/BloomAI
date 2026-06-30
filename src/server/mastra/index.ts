import { Mastra } from '@mastra/core/mastra'
import { chatAgent } from './chat-agent'

/**
 * Single Mastra instance for BloomAI chat. Agents are registered here and served
 * via `handleChatStream` on a Hono server (see chat-server.ts) — no `mastra` CLI
 * or generated server is required. Future agents/workflows register here too.
 */
export const mastra = new Mastra({
  agents: { chat: chatAgent },
})
