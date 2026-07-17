import { Mastra } from '@mastra/core/mastra'
import { InMemoryStore } from '@mastra/core/storage'
import { Observability } from '@mastra/observability'
import { OtelBridge } from '@mastra/otel-bridge'
import { serverLogger } from '../logger/logger'
import { readConfigValue } from '../config/config'
import { chatAgent } from './chat-agent'
import { planAgent } from './plan-agent'
import { writerAgent, coderAgent } from './agents/team'

// Wire Mastra spans into the global OTel TracerProvider (registered by initTracing in index.ts).
// OtelBridge.createSpan() calls trace.getTracer() at request time, so the provider only needs to
// be registered before the first request, not before this module is loaded.
const otelEnabled = readConfigValue('OTEL_ENABLED', 'true').value !== 'false'
const observability = otelEnabled
  ? new Observability({
      configs: {
        default: {
          serviceName: 'bloomai',
          bridge: new OtelBridge(),
        },
      },
    })
  : undefined

/**
 * Single Mastra instance for BloomAI chat. Agents + workflows are registered here
 * and served via @mastra/ai-sdk on the Hono server — no `mastra` CLI or generated
 * server is required.
 */
export const mastra = new Mastra({
  storage: new InMemoryStore(),
  logger: serverLogger,
  observability,
  agents: {
    chat: chatAgent,
    'plan-planner': planAgent,
    writer: writerAgent,
    coder: coderAgent,
  },
})

