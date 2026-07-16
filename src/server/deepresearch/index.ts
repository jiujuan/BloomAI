import { createDeepResearchExecutor, type DeepResearchRuntimeAdapter } from './executor'
import { createDeepResearchService } from './deep-research.service'

export { createDeepResearchExecutor } from './executor'
export type { CreateDeepResearchExecutorOptions, DeepResearchExecutor, DeepResearchRuntimeAdapter } from './executor'
export { createDeepResearchService } from './deep-research.service'
export type { CreateDeepResearchServiceOptions, DeepResearchScheduler } from './deep-research.service'

const unavailableRuntime: DeepResearchRuntimeAdapter = {
  async start(): Promise<void> {
    throw new Error('Deep Research runtime is not configured yet.')
  },
  async resume(): Promise<void> {
    throw new Error('Deep Research runtime is not configured yet.')
  },
}

export function createDeepResearchModule(runtime: DeepResearchRuntimeAdapter = unavailableRuntime) {
  const executor = createDeepResearchExecutor({ runtime })
  const service = createDeepResearchService({ runtime: executor })

  return Object.freeze({
    ...service,
    executor,
  })
}

export const deepResearchModule = createDeepResearchModule()
