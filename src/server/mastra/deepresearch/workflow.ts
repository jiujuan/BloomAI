import { createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import type { BriefPlanner } from './agents/brief-planner'
import type { QueryPlanner } from './agents/query-planner'
import type { ReturnTypeOfContentService, ReturnTypeOfSearchService } from './steps/types'
import type { SourceCurator } from '@server/services/deepresearch/source-curator'
import type { DeepResearchRepositories } from './workflow-context'
import { createBuildBriefStep } from './steps/build-brief'
import { createCurateSourcesStep } from './steps/curate-sources'
import { createExecuteSearchesStep } from './steps/execute-searches'
import { createFetchSourcesStep } from './steps/fetch-sources'
import { createFinalizeSkeletonStep } from './steps/finalize-skeleton'
import { createLoadRunStep } from './steps/load-run'
import { createPlanQuestionsStep } from './steps/plan-questions'
import { createPlanQueriesStep } from './steps/plan-queries'

const workflowInputSchema = z.object({ runId: z.string().min(1) })
const workflowOutputSchema = z.object({ runId: z.string().min(1), artifactId: z.string().min(1) })

export interface CreateDeepResearchWorkflowOptions {
  repositories: DeepResearchRepositories
  planner: BriefPlanner
  queryPlanner: QueryPlanner
  searchService: ReturnTypeOfSearchService
  sourceCurator: SourceCurator
  contentService: ReturnTypeOfContentService
  dataDir?: string
}

export function createDeepResearchWorkflow(options: CreateDeepResearchWorkflowOptions) {
  const loadRun = createLoadRunStep(options.repositories)
  const buildBrief = createBuildBriefStep({ repositories: options.repositories, planner: options.planner })
  const planQuestions = createPlanQuestionsStep(options.repositories)
  const planQueries = createPlanQueriesStep({ repositories: options.repositories, planner: options.queryPlanner })
  const executeSearches = createExecuteSearchesStep({ repositories: options.repositories, searchService: options.searchService })
  const curateSources = createCurateSourcesStep({ repositories: options.repositories, curator: options.sourceCurator })
  const fetchSources = createFetchSourcesStep({ repositories: options.repositories, contentService: options.contentService })
  const finalizeSkeleton = createFinalizeSkeletonStep(options.repositories, options.dataDir)

  return createWorkflow({ id: 'deep-research-v1', inputSchema: workflowInputSchema, outputSchema: workflowOutputSchema })
    .then(loadRun)
    .then(buildBrief)
    .then(planQuestions)
    .then(planQueries)
    .then(executeSearches)
    .then(curateSources)
    .then(fetchSources)
    .then(finalizeSkeleton)
    .commit()
}
