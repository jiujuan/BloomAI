import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { Mastra } from '@mastra/core/mastra'
import { LibSQLStore } from '@mastra/libsql'
import type { ResearchClarificationInput } from '@shared/deepresearch/contracts'
import { clarificationSchema } from '@shared/deepresearch/schemas'
import { getDataDir } from '@server/db/paths'
import { serverLogger } from '@server/logger/logger'
import { briefPlannerAgent, createDeterministicBriefPlanner, type BriefPlanner } from './agents/brief-planner'
import { evidenceAnalystAgent, createDeterministicEvidenceAnalyst } from './agents/evidence-analyst'
import { gapAnalystAgent, createDeterministicGapAnalyst, type GapAnalyst } from './agents/gap-analyst'
import { createDeterministicQueryPlanner, queryPlannerAgent, type QueryPlanner } from './agents/query-planner'
import { createContentService } from '@server/services/deepresearch/content-service'
import { EvidenceService, type EvidenceAnalyst } from '@server/services/deepresearch/evidence-service'
import { createSearchService } from '@server/services/deepresearch/search-service'
import { SourceCurator } from '@server/services/deepresearch/source-curator'
import { defaultDeepResearchRepositories, type DeepResearchRepositories } from './workflow-context'
import { createDeepResearchWorkflow } from './workflow'

export interface CreateDeepResearchMastraRuntimeOptions {
  dataDir?: string
  storage?: LibSQLStore
  planner?: BriefPlanner
  queryPlanner?: QueryPlanner
  evidenceAnalyst?: EvidenceAnalyst
  gapAnalyst?: GapAnalyst
  evidenceService?: EvidenceService
  searchService?: ReturnType<typeof createSearchService>
  sourceCurator?: SourceCurator
  contentService?: ReturnType<typeof createContentService>
  repositories?: DeepResearchRepositories
}

export function resolveDeepResearchRuntimeUrl(dataDir = getDataDir()): string {
  fs.mkdirSync(dataDir, { recursive: true })
  return pathToFileURL(path.join(dataDir, 'deep-research-runtime.db')).href
}

export function createDeepResearchMastraRuntime(options: CreateDeepResearchMastraRuntimeOptions = {}) {
  const repositories = options.repositories ?? defaultDeepResearchRepositories
  const planner = options.planner ?? createDeterministicBriefPlanner()
  const queryPlanner = options.queryPlanner ?? createDeterministicQueryPlanner()
  const evidenceAnalyst = options.evidenceAnalyst ?? createDeterministicEvidenceAnalyst()
  const gapAnalyst = options.gapAnalyst ?? createDeterministicGapAnalyst()
  const evidenceService = options.evidenceService ?? new EvidenceService({
    analyst: evidenceAnalyst,
    sourceRepo: repositories.researchSourceRepo,
    evidenceRepo: repositories.researchEvidenceRepo,
    questionRepo: repositories.researchQuestionRepo,
  })
  const searchService = options.searchService ?? createSearchService()
  const sourceCurator = options.sourceCurator ?? new SourceCurator()
  const contentService = options.contentService ?? createContentService({ repositories })
  const storage = options.storage ?? new LibSQLStore({
    id: 'bloomai-deep-research-runtime',
    url: resolveDeepResearchRuntimeUrl(options.dataDir),
  })
  const workflow = createDeepResearchWorkflow({ repositories, planner, queryPlanner, gapAnalyst, evidenceService, searchService, sourceCurator, contentService, dataDir: options.dataDir })
  const mastra = new Mastra({
    storage,
    logger: serverLogger,
    agents: {
      'deep-research-brief-planner': briefPlannerAgent,
      'deep-research-query-planner': queryPlannerAgent,
      'deep-research-evidence-analyst': evidenceAnalystAgent,
      'deep-research-gap-analyst': gapAnalystAgent,
    },
    workflows: { 'deep-research-v1': workflow },
  })
  const activeRuns = new Map<string, Awaited<ReturnType<typeof workflow.createRun>>>()

  async function loadWorkflowRun(workflowRunId: string) {
    const active = activeRuns.get(workflowRunId)
    if (active) return active

    const restored = await workflow.createRun({ runId: workflowRunId })
    activeRuns.set(workflowRunId, restored)
    return restored
  }

  return Object.freeze({
    mastra,
    workflow,
    async start(runId: string) {
      const run = repositories.researchRunRepo.get(runId)
      if (!run) throw new Error('Deep Research Run not found: ' + runId)

      const workflowRun = await workflow.createRun()
      activeRuns.set(workflowRun.runId, workflowRun)
      repositories.researchRunRepo.setWorkflowRunId(runId, workflowRun.runId)
      return workflowRun.start({ inputData: { runId } })
    },
    async resume(runId: string, resumeData: ResearchClarificationInput) {
      const parsed = clarificationSchema.parse(resumeData)
      const run = repositories.researchRunRepo.get(runId)
      if (!run?.workflowRunId) throw new Error('Deep Research workflow run not found: ' + runId)

      const workflowRun = await loadWorkflowRun(run.workflowRunId)
      return workflowRun.resume({ resumeData: parsed, label: 'planning' })
    },
  })
}
