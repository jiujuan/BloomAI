import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { Mastra } from '@mastra/core/mastra'
import { LibSQLStore } from '@mastra/libsql'
import type { ResearchClarificationInput, ResearchRunDto } from '@shared/deepresearch/contracts'
import type { DeepResearchAttemptExecutionContext } from '@server/deepresearch/executor'
import { clarificationSchema } from '@shared/deepresearch/schemas'
import { getDataDir } from '@server/db/paths'
import { serverLogger } from '@server/logger/logger'
import { createDeterministicBriefPlanner, type BriefPlanner } from './agents/brief-planner'
import { createDeterministicEvidenceAnalyst } from './agents/evidence-analyst'
import { createDeterministicGapAnalyst, type GapAnalyst } from './agents/gap-analyst'
import { createDeterministicQueryPlanner, type QueryPlanner } from './agents/query-planner'
import { createDeterministicSectionWriter, type SectionWriter } from './agents/section-writer'
import { createDeterministicClaimExtractor, type ClaimExtractor } from './agents/claim-extractor'
import { createDeterministicCitationVerifier, type CitationVerifier } from './agents/citation-verifier'
import { createDeterministicReportCritic, type ReportCritic } from './agents/report-critic'
import type { ReportTranslator } from './agents/report-translator'
import { createLlmDeepResearchAdapters, type LlmDeepResearchAdapters, type ResearchLlmUsage } from './llm-adapters'
import { resolveResearchMastraModel } from '../model-resolver'
import { createContentService } from '@server/services/deepresearch/content-service'
import { ArtifactService } from '@server/services/deepresearch/artifact-service'
import { CitationService } from '@server/services/deepresearch/citation-service'
import { EvidenceService, type EvidenceAnalyst } from '@server/services/deepresearch/evidence-service'
import { createSearchService } from '@server/services/deepresearch/search-service'
import { SourceCurator } from '@server/services/deepresearch/source-curator'
import { defaultDeepResearchRepositories, type DeepResearchRepositories } from './workflow-context'
import { createDeepResearchWorkflow } from './workflow'
import { bindWorkflowExecution, resolveWorkflowResumeCursor } from './steps/checkpoint-replay'

export interface CreateDeepResearchMastraRuntimeOptions {
  dataDir?: string; storage?: LibSQLStore; /** Explicit dev/offline switch; production callers must leave this false. */ useDeterministicAdapters?: boolean; /** Dependency-injection seam for production-composition tests. */ llmAdapterFactory?: typeof createLlmDeepResearchAdapters; researchModelResolver?: typeof resolveResearchMastraModel; planner?: BriefPlanner; queryPlanner?: QueryPlanner; evidenceAnalyst?: EvidenceAnalyst; gapAnalyst?: GapAnalyst; evidenceService?: EvidenceService; citationService?: CitationService; artifactService?: ArtifactService; reportTranslator?: ReportTranslator; sectionWriter?: SectionWriter; claimExtractor?: ClaimExtractor; citationVerifier?: CitationVerifier; reportCritic?: ReportCritic; searchService?: ReturnType<typeof createSearchService>; sourceCurator?: SourceCurator; contentService?: ReturnType<typeof createContentService>; repositories?: DeepResearchRepositories
}
export function resolveDeepResearchRuntimeUrl(dataDir = getDataDir()): string { fs.mkdirSync(dataDir, { recursive: true }); return pathToFileURL(path.join(dataDir, 'deep-research-runtime.db')).href }

function hasExplicitTestAdapters(options: CreateDeepResearchMastraRuntimeOptions): boolean { return Boolean(options.useDeterministicAdapters || options.planner || options.queryPlanner || options.evidenceAnalyst || options.gapAnalyst || options.sectionWriter || options.claimExtractor || options.citationVerifier || options.reportCritic || options.reportTranslator || options.evidenceService) }
function deterministicAdapters(): LlmDeepResearchAdapters { return { planner: createDeterministicBriefPlanner(), queryPlanner: createDeterministicQueryPlanner(), evidenceAnalyst: createDeterministicEvidenceAnalyst(), gapAnalyst: createDeterministicGapAnalyst(), sectionWriter: createDeterministicSectionWriter(), claimExtractor: createDeterministicClaimExtractor(), citationVerifier: createDeterministicCitationVerifier(), reportCritic: createDeterministicReportCritic(), reportTranslator: { async translate({ markdown }) { return markdown } } } }

export function createDeepResearchMastraRuntime(options: CreateDeepResearchMastraRuntimeOptions = {}) {
  const repositories = options.repositories ?? defaultDeepResearchRepositories
  const testComposition = hasExplicitTestAdapters(options)
  const llmAdapterFactory = options.llmAdapterFactory ?? createLlmDeepResearchAdapters
  const researchModelResolver = options.researchModelResolver ?? resolveResearchMastraModel
  const storage = options.storage ?? new LibSQLStore({ id: 'bloomai-deep-research-runtime', url: resolveDeepResearchRuntimeUrl(options.dataDir) })
  const mastra = new Mastra({ storage, logger: serverLogger, agents: {}, workflows: {} })
  const activeRuns = new Map<string, { workflow: ReturnType<typeof createDeepResearchWorkflow>; workflowRun: any }>()
  const searchService = options.searchService ?? createSearchService()
  const sourceCurator = options.sourceCurator ?? new SourceCurator()
  const contentService = options.contentService ?? createContentService({ repositories })
  const citationService = options.citationService ?? new CitationService({ reportRepo: repositories.researchReportRepo, listClaims: (runId) => repositories.researchReportRepo.listClaims(runId), listEvidence: (runId) => repositories.researchEvidenceRepo.list(runId) })
  const artifactService = options.artifactService ?? new ArtifactService({ reportRepo: repositories.researchReportRepo, dataDir: options.dataDir })

  function reportUsage(runId: string, attemptId: string, entry: ResearchLlmUsage) {
    repositories.researchRunRepo.addModelUsage(runId, entry)
    repositories.researchAttemptRepo.addModelUsage(attemptId, entry)
    if (entry.tokens === 0) {
      serverLogger.warn('Deep Research model response reported zero tokens.', { runId, attemptId, stage: entry.stage })
    }
  }
  async function workflowFor(run: ResearchRunDto, context: DeepResearchAttemptExecutionContext): Promise<{ workflow: ReturnType<typeof createDeepResearchWorkflow> }> {
    let adapters: LlmDeepResearchAdapters
    if (testComposition) {
      const defaults = deterministicAdapters()
      adapters = { planner: options.planner ?? defaults.planner, queryPlanner: options.queryPlanner ?? defaults.queryPlanner, evidenceAnalyst: options.evidenceAnalyst ?? defaults.evidenceAnalyst, gapAnalyst: options.gapAnalyst ?? defaults.gapAnalyst, sectionWriter: options.sectionWriter ?? defaults.sectionWriter, claimExtractor: options.claimExtractor ?? defaults.claimExtractor, citationVerifier: options.citationVerifier ?? defaults.citationVerifier, reportCritic: options.reportCritic ?? defaults.reportCritic, reportTranslator: options.reportTranslator ?? defaults.reportTranslator }
    } else {
      if (!run.modelSelectionSnapshot) throw new Error('RESEARCH_MODEL_UNAVAILABLE: Deep Research Run has no model selection snapshot.')
      const model = await researchModelResolver(run.modelSelectionSnapshot)
      adapters = llmAdapterFactory({ model, usageReporter: (entry) => reportUsage(run.id, context.attemptId, entry) })
    }
    const evidenceService = options.evidenceService ?? new EvidenceService({ analyst: adapters.evidenceAnalyst, sourceRepo: repositories.researchSourceRepo, evidenceRepo: repositories.researchEvidenceRepo, questionRepo: repositories.researchQuestionRepo })
    const workflow = createDeepResearchWorkflow({ repositories, planner: adapters.planner, queryPlanner: adapters.queryPlanner, gapAnalyst: adapters.gapAnalyst, evidenceService, citationService, artifactService, reportTranslator: adapters.reportTranslator, sectionWriter: adapters.sectionWriter, claimExtractor: adapters.claimExtractor, citationVerifier: adapters.citationVerifier, reportCritic: adapters.reportCritic, searchService, sourceCurator, contentService })
    // Mastra attaches durable storage to a workflow only after registration.
    // Register this Run-specific adapter composition before creating or restoring its run.
    mastra.addWorkflow(workflow)
    return { workflow }
  }
  async function loadWorkflowRun(run: ResearchRunDto, context: DeepResearchAttemptExecutionContext) {
    if (!run.workflowRunId) throw new Error('Deep Research workflow run not found: ' + run.id)
    const active = activeRuns.get(run.workflowRunId)
    if (active) return active
    const { workflow } = await workflowFor(run, context)
    const workflowRun = await workflow.createRun({ runId: run.workflowRunId })
    const result = { workflow, workflowRun }; activeRuns.set(run.workflowRunId, result); return result
  }

  return Object.freeze({
    mastra,
    async start(context: DeepResearchAttemptExecutionContext) {
      const run = repositories.researchRunRepo.get(context.runId); if (!run) throw new Error('Deep Research Run not found: ' + context.runId)
      const { workflow } = await workflowFor(run, context); const workflowRun = await workflow.createRun(); activeRuns.set(workflowRun.runId, { workflow, workflowRun }); bindWorkflowExecution(run.id, context); repositories.researchRunRepo.setWorkflowRunId(run.id, workflowRun.runId)
      return workflowRun.start({ inputData: { runId: run.id, attempt: { attemptId: context.attemptId, executorId: context.executorId, ownershipToken: context.ownershipToken, resumeCursor: context.resumeCursor } } })
    },
    async resume(context: DeepResearchAttemptExecutionContext, resumeData: ResearchClarificationInput) {
      const parsed = clarificationSchema.parse(resumeData); const run = repositories.researchRunRepo.get(context.runId); if (!run?.workflowRunId) throw new Error('Deep Research workflow run not found: ' + context.runId)
      const active = await loadWorkflowRun(run, context); const resolution = resolveWorkflowResumeCursor(repositories, run, context.resumeCursor); bindWorkflowExecution(run.id, { ...context, resumeCursor: resolution.cursor }); return active.workflowRun.resume({ resumeData: parsed, label: 'planning' })
    },
    async getWorkflowRunState(workflowRunId: string) { const active = activeRuns.get(workflowRunId); if (!active) return null; const state = await active.workflow.getWorkflowRunById(workflowRunId, { fields: ['suspendedPaths', 'resumeLabels'] }); return state ? { status: state.status } : null },
  })
}
