import { createDeepResearchMastraRuntime } from '../mastra/deepresearch/mastra'
import { createDeepResearchExecutor, type DeepResearchRuntimeAdapter } from './executor'
import { createDeepResearchService } from './deep-research.service'

export { createDeepResearchExecutor } from './executor'
export type { CreateDeepResearchExecutorOptions, DeepResearchExecutor, DeepResearchRuntimeAdapter } from './executor'
export { createDeepResearchService } from './deep-research.service'
export type { CreateDeepResearchServiceOptions, DeepResearchScheduler } from './deep-research.service'

const defaultRuntime = createDeepResearchMastraRuntime()

export function createDeepResearchModule(runtime: DeepResearchRuntimeAdapter = defaultRuntime) {
  const executor = createDeepResearchExecutor({ runtime })
  const service = createDeepResearchService({ runtime: executor })

  return Object.freeze({
    ...service,
    executor,
  })
}

export const deepResearchModule = createDeepResearchModule()
