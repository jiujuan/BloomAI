import { createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import type { BriefPlanner } from './agents/brief-planner'
import type { QueryPlanner } from './agents/query-planner'
import type { GapAnalyst } from './agents/gap-analyst'
import type { SectionWriter } from './agents/section-writer'
import type { ClaimExtractor } from './agents/claim-extractor'
import type { CitationVerifier } from './agents/citation-verifier'
import type { ReportCritic } from './agents/report-critic'
import type { EvidenceService } from '@server/services/deepresearch/evidence-service'
import type { CitationService } from '@server/services/deepresearch/citation-service'
import type { ArtifactService } from '@server/services/deepresearch/artifact-service'
import type { ReportTranslator } from './agents/report-translator'
import type { ReturnTypeOfContentService, ReturnTypeOfSearchService } from './steps/types'
import type { SourceCurator } from '@server/services/deepresearch/source-curator'
import type { DeepResearchRepositories } from './workflow-context'
import { createAssessCoverageStep } from './steps/assess-coverage'
import { createAssessQualityStep } from './steps/assess-quality'
import { createBuildBriefStep } from './steps/build-brief'
import { createBuildOutlineStep } from './steps/build-outline'
import { createCurateSourcesStep } from './steps/curate-sources'
import { createDraftSectionsStep } from './steps/draft-sections'
import { createExecuteSearchesStep } from './steps/execute-searches'
import { createExtractClaimsStep } from './steps/extract-claims'
import { createExtractEvidenceStep } from './steps/extract-evidence'
import { createFetchSourcesStep } from './steps/fetch-sources'
import { createFinalizeArtifactsStep } from './steps/finalize-artifacts'
import { createGapFillIterationStep, shouldStopGapFill } from './steps/gap-fill-iteration'
import { createLoadRunStep } from './steps/load-run'
import { createPlanQuestionsStep } from './steps/plan-questions'
import { createPlanQueriesStep } from './steps/plan-queries'
import { createRepairReportStep } from './steps/repair-report'
import { createVerifyCitationsStep } from './steps/verify-citations'

const workflowInputSchema = z.object({ runId: z.string().min(1) })
const workflowOutputSchema = z.object({ runId: z.string().min(1), artifactId: z.string().min(1) })

export interface CreateDeepResearchWorkflowOptions {
  repositories: DeepResearchRepositories
  planner: BriefPlanner
  queryPlanner: QueryPlanner
  gapAnalyst: GapAnalyst
  evidenceService: EvidenceService
  citationService: CitationService
  artifactService: ArtifactService
  reportTranslator: ReportTranslator
  sectionWriter: SectionWriter
  claimExtractor: ClaimExtractor
  citationVerifier: CitationVerifier
  reportCritic: ReportCritic
  searchService: ReturnTypeOfSearchService
  sourceCurator: SourceCurator
  contentService: ReturnTypeOfContentService
}

export function createDeepResearchWorkflow(options: CreateDeepResearchWorkflowOptions) {
  const loadRun = createLoadRunStep(options.repositories)
  const buildBrief = createBuildBriefStep({ repositories: options.repositories, planner: options.planner })
  const planQuestions = createPlanQuestionsStep(options.repositories)
  const planQueries = createPlanQueriesStep({ repositories: options.repositories, planner: options.queryPlanner })
  const executeSearches = createExecuteSearchesStep({ repositories: options.repositories, searchService: options.searchService })
  const curateSources = createCurateSourcesStep({ repositories: options.repositories, curator: options.sourceCurator })
  const fetchSources = createFetchSourcesStep({ repositories: options.repositories, contentService: options.contentService })
  const extractEvidence = createExtractEvidenceStep({ repositories: options.repositories, evidenceService: options.evidenceService })
  const assessCoverage = createAssessCoverageStep({ repositories: options.repositories, evidenceService: options.evidenceService })
  const gapFillIteration = createGapFillIterationStep({ repositories: options.repositories, gapAnalyst: options.gapAnalyst, searchService: options.searchService, sourceCurator: options.sourceCurator, contentService: options.contentService, evidenceService: options.evidenceService })
  const buildOutline = createBuildOutlineStep(options.repositories)
  const draftSections = createDraftSectionsStep({ repositories: options.repositories, writer: options.sectionWriter })
  const extractClaims = createExtractClaimsStep({ repositories: options.repositories, extractor: options.claimExtractor, citationService: options.citationService })
  const verifyCitations = createVerifyCitationsStep({ repositories: options.repositories, verifier: options.citationVerifier })
  const repairReport = createRepairReportStep({ repositories: options.repositories, critic: options.reportCritic })
  const assessQuality = createAssessQualityStep(options.repositories)
  const finalizeArtifacts = createFinalizeArtifactsStep({ repositories: options.repositories, artifactService: options.artifactService, reportTranslator: options.reportTranslator })

  return createWorkflow({ id: 'deep-research-v1', inputSchema: workflowInputSchema, outputSchema: workflowOutputSchema })
    .then(loadRun)
    .then(buildBrief)
    .then(planQuestions)
    .then(planQueries)
    .then(executeSearches)
    .then(curateSources)
    .then(fetchSources)
    .then(extractEvidence)
    .then(assessCoverage)
    .dountil(gapFillIteration, async ({ inputData }) => shouldStopGapFill(inputData))
    .then(buildOutline)
    .foreach(draftSections, { concurrency: 4 })
    .then(extractClaims)
    .then(verifyCitations)
    .then(repairReport)
    .then(assessQuality)
    .then(finalizeArtifacts)
    .commit()
}
