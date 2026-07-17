import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import type { CitationVerifier } from '../agents/citation-verifier'
import type { DeepResearchRepositories } from '../workflow-context'
import { deepResearchTelemetryContext, loadRunnableRun } from '../workflow-context'
import { recordDeepResearchClaimVerification } from '@server/telemetry/metrics'

export function createVerifyCitationsStep({ repositories, verifier }: { repositories: DeepResearchRepositories; verifier: CitationVerifier }) {
  return createStep({
    id: 'deep-research-verify-citations',
    inputSchema: z.object({ runId: z.string().min(1) }),
    outputSchema: z.object({ runId: z.string().min(1) }),
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['synthesizing'])
      repositories.researchRunRepo.transitionWithEvent(run.id, 'verifying', { phase: 'verifying_citations', progress: 84 })
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
          const result = await verifier.verify({ claim, evidence })
          repositories.researchReportRepo.updateCitation(citation.id, { entailmentStatus: result.status, rationale: result.rationale })
          statuses.push(result.status)
        }
        const status = statuses.includes('supported') ? 'supported' : statuses.includes('partially_supported') ? 'partially_supported' : 'unsupported'
        repositories.researchReportRepo.updateClaim(claim.id, { verificationStatus: status })
        repositories.researchEventRepo.append({ runId: run.id, type: 'research.claim.verified', phase: 'verifying_citations', payload: { id: claim.id, status } })
        verifiedClaimCount += 1
      }
      recordDeepResearchClaimVerification(verifiedClaimCount, deepResearchTelemetryContext(run, { claims: verifiedClaimCount }))
      return { runId: run.id }
    },
  })
}
