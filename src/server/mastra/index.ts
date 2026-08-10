import { Mastra } from '@mastra/core/mastra'
import { LibSQLStore } from '@mastra/libsql'
import { Observability } from '@mastra/observability'
import { OtelBridge } from '@mastra/otel-bridge'
import { serverLogger } from '../logger/logger'
import { readConfigValue } from '../config/config'
import { chatAgent, createChatAgent } from './chat-agent'
import { createWriterAgent, createCoderAgent } from './agents/team'
import type { McpAgentToolSurfaceDependencies } from '../mcp/agent-tool-surface'
import { mcpAdapter, mcpConnectionManager, mcpCapabilityBroker } from '../mcp/composition-root'
export { mcpAdapter, mcpConnectionManager, mcpCapabilityBroker } from '../mcp/composition-root'
import { MastraSkillSource } from './skills/mastra-skill-source'
import { planAgent } from './plan-agent'
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

/**
 * Process-level MCP composition root. Construction is deliberately side-effect free:
 * the adapter validates and connects only when the Connection Manager is asked to
 * execute or discover a tool, never while an Agent or Mastra runtime is built.
 */
export const mcpAgentToolSurface: McpAgentToolSurfaceDependencies = {
  broker: mcpCapabilityBroker,
}

export type MastraRuntimeDependencies = {
  /** Inject a request/runtime source in tests or an alternate composition root. */
  readonly skillSource?: MastraSkillSource
  /** Preserve the ability to supply a fully constructed Chat Agent. */
  readonly chatAgent?: typeof chatAgent
  /** Replace the process-level MCP surface in tests or an alternate composition root. */
  readonly mcpToolSurface?: McpAgentToolSurfaceDependencies
  /** Replace specialist Agents in tests or an alternate composition root. */
  readonly writerAgent?: ReturnType<typeof createWriterAgent>
  readonly coderAgent?: ReturnType<typeof createCoderAgent>
}

export function createMastraRuntime(dependencies: MastraRuntimeDependencies = {}) {
  const mcpToolSurface = dependencies.mcpToolSurface ?? mcpAgentToolSurface
  const resolvedChatAgent = dependencies.chatAgent ?? createChatAgent({
    ...(dependencies.skillSource ? { skillSource: dependencies.skillSource } : {}),
    mcpToolSurface,
  })
  const resolvedWriterAgent = dependencies.writerAgent ?? createWriterAgent({ mcpToolSurface })
  const resolvedCoderAgent = dependencies.coderAgent ?? createCoderAgent({ mcpToolSurface })
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
      writer: resolvedWriterAgent,
      coder: resolvedCoderAgent,
      'scheduled-task': scheduledTaskAgent,
    },
  })
}

export const mastra = createMastraRuntime()

export type MastraRuntimeShutdownDependencies = {
  mastra: Pick<typeof mastra, 'shutdown'>
  mcpConnectionManager: Pick<typeof mcpConnectionManager, 'disconnectAll'>
  projectWorkspaceFactory: Pick<typeof projectWorkspaceFactory, 'shutdown'>
  scheduleRuntimeStorage: Pick<typeof scheduleRuntimeStorage, 'close'>
}

/** Releases all Mastra runtime resources during application and test shutdown. */
export async function shutdownMastraRuntime(
  overrides: Partial<MastraRuntimeShutdownDependencies> = {},
): Promise<void> {
  const runtime: MastraRuntimeShutdownDependencies = {
    mastra,
    mcpConnectionManager,
    projectWorkspaceFactory,
    scheduleRuntimeStorage,
    ...overrides,
  }
  await runtime.mastra.shutdown()
  await runtime.mcpConnectionManager.disconnectAll()
  await runtime.projectWorkspaceFactory.shutdown()
  await runtime.scheduleRuntimeStorage.close()
}
