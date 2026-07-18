import { createStep } from '@mastra/core/workflows'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ClaimExtractor } from '../agents/claim-extractor'
import type { CitationService } from '@server/services/deepresearch/citation-service'
import { reportSectionJobSchema } from './build-outline'
import type { DeepResearchRepositories } from '../workflow-context'
import { checkpointWorkflowPhase, isReplayPastPhase } from './checkpoint-replay'
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
      const evidence = repositories.researchEvidenceRepo.list(run.id)
      for (const section of repositories.researchReportRepo.listSections(run.id)) {
        const extracted = await extractor.extract({ run, section, evidence: evidence.slice(0, 3) })
        for (const [index, item] of extracted.entries()) {
          const claim = repositories.researchReportRepo.upsertClaim({
            runId: run.id,
            sectionId: section.id,
            text: item.text,
            kind: item.kind,
            importance: item.importance,
            verificationStatus: item.kind === 'factual' ? 'partially_supported' : 'not_applicable',
            confidence: item.confidence,
            repairHistory: [],
            idempotencyKey: 'report-claim:v1:' + createHash('sha256').update(section.id + '\u0000' + index + '\u0000' + item.text).digest('hex'),
          })
          if (item.kind === 'factual') {
            for (const evidenceId of item.evidenceIds) citationService.bind({ runId: run.id, claimId: claim.id, evidenceId, entailmentStatus: 'partially_supported', rationale: 'Pending citation verification.' })
          }
        }
      }
      repositories.researchRunRepo.transitionWithEvent(run.id, 'synthesizing', { phase: 'extracting_claims', progress: 76 })
      checkpointWorkflowPhase(repositories, run, 'extracting_claims', 'verifying_citations')
      return { runId: run.id }
    },
  })
}
