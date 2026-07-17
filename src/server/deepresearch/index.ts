import { createDeepResearchExecutor, type DeepResearchRuntimeAdapter } from './executor'
import { createDeepResearchService } from './deep-research.service'

export { createDeepResearchExecutor } from './executor'
export type { CreateDeepResearchExecutorOptions, DeepResearchExecutor, DeepResearchRuntimeAdapter } from './executor'
export { createDeepResearchService } from './deep-research.service'
export type { CreateDeepResearchServiceOptions, DeepResearchScheduler } from './deep-research.service'

let defaultRuntime: DeepResearchRuntimeAdapter | undefined
let defaultRuntimePromise: Promise<DeepResearchRuntimeAdapter> | undefined

function getDefaultRuntime(): DeepResearchRuntimeAdapter {
  defaultRuntime ??= {
    async start(runId: string): Promise<unknown> {
      const runtime = await loadDefaultRuntime()
      return runtime.start(runId)
    },
    async resume(runId, resumeData): Promise<unknown> {
      const runtime = await loadDefaultRuntime()
      return runtime.resume(runId, resumeData)
    },
    async getWorkflowRunState(workflowRunId) {
      const runtime = await loadDefaultRuntime()
      return runtime.getWorkflowRunState?.(workflowRunId) ?? null
    },
  }
  return defaultRuntime
}

async function loadDefaultRuntime(): Promise<DeepResearchRuntimeAdapter> {
  // The development server executes TypeScript through tsx's CommonJS hook.
  // Native dynamic import() bypasses that hook, so it cannot resolve the
  // extensionless TypeScript module or its @server/@shared aliases.
  defaultRuntimePromise ??= Promise.resolve().then(() => {
    const { createDeepResearchMastraRuntime } = require('../mastra/deepresearch/mastra')
    return createDeepResearchMastraRuntime()
  })
  return defaultRuntimePromise
}

export function createDeepResearchModule(runtime: DeepResearchRuntimeAdapter = getDefaultRuntime()) {
  const executor = createDeepResearchExecutor({ runtime })
  const service = createDeepResearchService({ runtime: executor })

  return Object.freeze({
    ...service,
    executor,
  })
}

let defaultModule: ReturnType<typeof createDeepResearchModule> | undefined

export function getDeepResearchModule(): ReturnType<typeof createDeepResearchModule> {
  defaultModule ??= createDeepResearchModule()
  return defaultModule
}
