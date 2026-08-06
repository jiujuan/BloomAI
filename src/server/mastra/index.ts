import { Mastra } from '@mastra/core/mastra'
import { LibSQLStore } from '@mastra/libsql'
import { Observability } from '@mastra/observability'
import { OtelBridge } from '@mastra/otel-bridge'
import { serverLogger } from '../logger/logger'
import { readConfigValue } from '../config/config'
import { chatAgent, createChatAgent } from './chat-agent'
import { MastraSkillSource } from './skills/mastra-skill-source'
import { planAgent } from './plan-agent'
import { writerAgent, coderAgent } from './agents/team'
import { createScheduleHooks } from './schedules/hooks'
import { createScheduledTaskRunWriter } from '../db/repositories/scheduled-task-run.repo'
import { scheduledTaskAgent } from './schedules/scheduled-task-agent'
import { resolveScheduleRuntimeUrl } from './schedules/storage'
import { projectWorkspaceFactory } from './workspace/project-workspace.factory'

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

export type MastraRuntimeDependencies = {
  /** Inject a request/runtime source in tests or an alternate composition root. */
  readonly skillSource?: MastraSkillSource
  /** Preserve the ability to supply a fully constructed Chat Agent. */
  readonly chatAgent?: typeof chatAgent
}

export function createMastraRuntime(dependencies: MastraRuntimeDependencies = {}) {
  const resolvedChatAgent = dependencies.chatAgent
    ?? (dependencies.skillSource ? createChatAgent({ skillSource: dependencies.skillSource }) : chatAgent)
  return new Mastra({
    storage: scheduleRuntimeStorage,
    logger: serverLogger,
    observability,
    schedules: createScheduleHooks({
      // Task run history is owned by the application database, not Mastra runtime storage.
      taskRunWriter: createScheduledTaskRunWriter(),
    }),
    agents: {
      chat: resolvedChatAgent,
      'plan-planner': planAgent,
      writer: writerAgent,
      coder: coderAgent,
      'scheduled-task': scheduledTaskAgent,
    },
  })
}

export const mastra = createMastraRuntime()

export type MastraRuntimeShutdownDependencies = {
  mastra: Pick<typeof mastra, 'shutdown'>
  projectWorkspaceFactory: Pick<typeof projectWorkspaceFactory, 'shutdown'>
  scheduleRuntimeStorage: Pick<typeof scheduleRuntimeStorage, 'close'>
}

/** Releases all Mastra runtime resources during application and test shutdown. */
export async function shutdownMastraRuntime(
  overrides: Partial<MastraRuntimeShutdownDependencies> = {},
): Promise<void> {
  const runtime: MastraRuntimeShutdownDependencies = {
    mastra,
    projectWorkspaceFactory,
    scheduleRuntimeStorage,
    ...overrides,
  }
  await runtime.mastra.shutdown()
  await runtime.projectWorkspaceFactory.shutdown()
  await runtime.scheduleRuntimeStorage.close()
}
