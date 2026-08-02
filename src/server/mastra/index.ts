import { Mastra } from '@mastra/core/mastra'
import { LibSQLStore } from '@mastra/libsql'
import { Observability } from '@mastra/observability'
import { OtelBridge } from '@mastra/otel-bridge'
import { serverLogger } from '../logger/logger'
import { readConfigValue } from '../config/config'
import { chatAgent } from './chat-agent'
import { planAgent } from './plan-agent'
import { writerAgent, coderAgent } from './agents/team'
import { createNoopScheduleTaskRunWriter, createScheduleHooks } from './schedules/hooks'
import { scheduledTaskAgent } from './schedules/scheduled-task-agent'
import { resolveScheduleRuntimeUrl } from './schedules/storage'

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
 * Single Mastra instance for BloomAI. Scheduled tasks use a dedicated LibSQL
 * runtime and the restricted threadless scheduled-task Agent; Chat persistence
 * continues to be owned by BloomAI's application database.
 */
export const scheduleRuntimeStorage = new LibSQLStore({
  id: 'bloomai-schedule-runtime',
  // File-backed in the app; ephemeral in Vitest so per-test DATA_DIR folders can be removed on Windows.
  url: process.env.VITEST ? ':memory:' : resolveScheduleRuntimeUrl(),
})

export const mastra = new Mastra({
  storage: scheduleRuntimeStorage,
  logger: serverLogger,
  observability,
  schedules: createScheduleHooks({
    // Phase 2 replaces this with the durable scheduled_task_runs repository adapter.
    taskRunWriter: createNoopScheduleTaskRunWriter(),
  }),
  agents: {
    chat: chatAgent,
    'plan-planner': planAgent,
    writer: writerAgent,
    coder: coderAgent,
    'scheduled-task': scheduledTaskAgent,
  },
})

/** Releases the dedicated LibSQL connection during application and test shutdown. */
export async function shutdownMastraRuntime(): Promise<void> {
  await mastra.shutdown()
  await scheduleRuntimeStorage.close()
}
