import { createStep } from '@mastra/core/workflows'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ClaimExtractor } from '../agents/claim-extractor'
import type { CitationService } from '@server/services/deepresearch/citation-service'
import { reportSectionJobSchema } from './build-outline'
import type { DeepResearchRepositories } from '../workflow-context'
import { assertWorkflowNotCancelled, checkpointWorkflowPhase, getWorkflowExecution, isReplayPastPhase } from './checkpoint-replay'
import { loadRunnableRun } from '../workflow-context'
import { selectEvidenceForSection } from './section-evidence'

export function createExtractClaimsStep({ repositories, extractor, citationService }: { repositories: DeepResearchRepositories; extractor: ClaimExtractor; citationService: CitationService }) {
  return createStep({
    id: 'deep-research-extract-claims',
    inputSchema: z.array(reportSectionJobSchema),
    outputSchema: z.object({ runId: z.string().min(1) }),
    execute: async ({ inputData }) => {
      const runId = inputData[0]?.runId
      if (!runId) throw new Error('Deep Research outline was empty.')
      const run = loadRunnableRun(repositories, runId, ['researching'])
      if (isReplayPastPhase(run.id, 'extracting_claims')) {
        repositories.researchRunRepo.transitionWithEvent(run.id, 'synthesizing', { phase: 'extracting_claims', progress: 76 })
        return { runId: run.id }
      }
      const questions = repositories.researchQuestionRepo.list(run.id)
      const evidence = repositories.researchEvidenceRepo.list(run.id)
      for (const section of repositories.researchReportRepo.listSections(run.id)) {
        assertWorkflowNotCancelled(repositories, run.id)
        const mappedQuestionIds = (repositories.researchReportRepo as Partial<typeof repositories.researchReportRepo>).listQuestionIdsForSection?.(section.id)
        const routedEvidence = selectEvidenceForSection(section, questions, evidence, mappedQuestionIds)
        const allowedEvidenceIds = new Set(routedEvidence.map((item) => item.id))
        const structuredClaims = section.draftPayload?.claims
        const extracted = structuredClaims && structuredClaims.length > 0 ? structuredClaims : await extractor.extract({ run, section, evidence: routedEvidence }, { signal: getWorkflowExecution(run.id)?.signal })
        assertWorkflowNotCancelled(repositories, run.id)
        for (const [index, item] of extracted.entries()) {
          if (item.evidenceIds.some((evidenceId) => !allowedEvidenceIds.has(evidenceId))) {
            throw new Error('Deep Research claim referenced out-of-scope section evidence.')
          }
          if (item.kind === 'factual' && item.evidenceIds.length === 0) {
            throw new Error('Deep Research factual claim requires routed evidence.')
          }
          const claim = repositories.researchReportRepo.upsertClaim({
            runId: run.id,
            sectionId: section.id,
            text: item.text,
            kind: item.kind,
            importance: item.importance,
            verificationStatus: item.kind === 'factual' ? 'partially_supported' : 'not_applicable',
            confidence: item.confidence,
            repairHistory: [],
            idempotencyKey: 'report-claim:v2:' + createHash('sha256').update(section.id + '\u0000' + index + '\u0000' + item.text).digest('hex'),
          })
          if (item.kind === 'factual') {
            for (const evidenceId of item.evidenceIds) citationService.bind({ runId: run.id, claimId: claim.id, evidenceId, entailmentStatus: 'partially_supported', rationale: 'Bound by the structured section draft; pending citation verification.' })
          }
        }
      }
      repositories.researchRunRepo.transitionWithEvent(run.id, 'synthesizing', { phase: 'extracting_claims', progress: 76 })
      checkpointWorkflowPhase(repositories, run, 'extracting_claims', 'verifying_citations')
      return { runId: run.id }
    },
  })
}
