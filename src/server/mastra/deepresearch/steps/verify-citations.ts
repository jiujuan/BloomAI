import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import type { CitationSemanticChecksDto } from '@shared/deepresearch/contracts'
import type { CitationVerifier } from '../agents/citation-verifier'
import type { DeepResearchRepositories } from '../workflow-context'
import { assertWorkflowNotCancelled, checkpointWorkflowPhase, getWorkflowExecution, isReplayPastPhase } from './checkpoint-replay'
import { deepResearchTelemetryContext, loadRunnableRun } from '../workflow-context'
import { recordDeepResearchClaimVerification } from '@server/telemetry/metrics'
import { classifyResearchError } from '@server/deepresearch/domain/errors'

export function createVerifyCitationsStep({ repositories, verifier }: { repositories: DeepResearchRepositories; verifier: CitationVerifier }) {
  return createStep({
    id: 'deep-research-verify-citations',
    inputSchema: z.object({ runId: z.string().min(1) }),
    outputSchema: z.object({ runId: z.string().min(1) }),
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['synthesizing'])
      assertWorkflowNotCancelled(repositories, run.id)
      repositories.researchRunRepo.transitionWithEvent(run.id, 'verifying', { phase: 'verifying_citations', progress: 84 })
      if (isReplayPastPhase(run.id, 'verifying_citations')) return { runId: run.id }
      const claims = repositories.researchReportRepo.listClaims(run.id)
      const evidenceById = new Map(repositories.researchEvidenceRepo.list(run.id).map((item) => [item.id, item]))
      const citationsByClaim = new Map<string, ReturnType<typeof repositories.researchReportRepo.listCitations>>()
      for (const citation of repositories.researchReportRepo.listCitations(run.id)) {
        const current = citationsByClaim.get(citation.claimId) ?? []
        current.push(citation)
        citationsByClaim.set(citation.claimId, current)
      }
      let verifiedClaimCount = 0
      for (const claim of claims) {
        const citations = citationsByClaim.get(claim.id) ?? []
        if (claim.kind !== 'factual') continue
        const statuses: string[] = []
        for (const citation of citations) {
          const evidence = evidenceById.get(citation.evidenceId)
          if (!evidence) continue
          assertWorkflowNotCancelled(repositories, run.id)
          try {
            const result = await verifier.verify({ claim, evidence }, { signal: getWorkflowExecution(run.id)?.signal })
            assertWorkflowNotCancelled(repositories, run.id)
            repositories.researchReportRepo.updateCitation(citation.id, {
              entailmentStatus: result.status,
              rationale: result.rationale,
              verificationMethod: result.verificationMethod,
              semanticChecks: result.checks,
            })
            statuses.push(result.status)
          } catch (error) {
            assertWorkflowNotCancelled(repositories, run.id)
            const classification = classifyResearchError(error)
            if (classification.category === 'cancelled') throw error
            const checks: CitationSemanticChecksDto = {
              entity: 'unclear', numericTemporal: 'unclear', relationship: 'unclear', stance: 'unclear',
            }
            repositories.researchReportRepo.updateCitation(citation.id, {
              entailmentStatus: 'unsupported',
              rationale: 'Semantic citation verification was unavailable (' + classification.code + '). Re-run verification with a configured research model before formal publication.',
              verificationMethod: 'unavailable',
              semanticChecks: checks,
            })
            repositories.researchEventRepo.append({
              runId: run.id,
              type: 'research.citation.verification_unavailable',
              phase: 'verifying_citations',
              payload: { id: citation.id, claimId: claim.id, errorCode: classification.code },
            })
            statuses.push('unsupported')
          }
        }
        const status = statuses.includes('supported') ? 'supported' : statuses.includes('partially_supported') ? 'partially_supported' : 'unsupported'
        repositories.researchReportRepo.updateClaim(claim.id, { verificationStatus: status })
        repositories.researchEventRepo.append({ runId: run.id, type: 'research.claim.verified', phase: 'verifying_citations', payload: { id: claim.id, status } })
        verifiedClaimCount += 1
      }
      recordDeepResearchClaimVerification(verifiedClaimCount, deepResearchTelemetryContext(run, { claims: verifiedClaimCount }))
      checkpointWorkflowPhase(repositories, run, 'verifying_citations', 'repair_report')
      return { runId: run.id }
    },
  })
}
