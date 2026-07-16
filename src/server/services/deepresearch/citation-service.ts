import type { ResearchCitationDto, ResearchClaimDto, ResearchEvidenceDto } from '@shared/deepresearch/contracts'
import type { UpsertResearchCitationInput } from '@server/db/repositories/deepresearch/research-report.repo'
import { ResearchDomainError } from '@server/deepresearch/domain/errors'

export interface CitationServiceOptions {
  reportRepo: { upsertCitation(input: UpsertResearchCitationInput): ResearchCitationDto }
  listClaims(runId: string): ResearchClaimDto[]
  listEvidence(runId: string): ResearchEvidenceDto[]
}

export class CitationService {
  constructor(private readonly options: CitationServiceOptions) {}

  bind(input: UpsertResearchCitationInput): ResearchCitationDto {
    const claim = this.options.listClaims(input.runId).find((item) => item.id === input.claimId)
    const evidence = this.options.listEvidence(input.runId).find((item) => item.id === input.evidenceId)
    if (!claim || !evidence || claim.runId !== input.runId || evidence.runId !== input.runId) {
      throw new ResearchDomainError(
        'RESEARCH_CROSS_RUN_CITATION',
        'Claims and evidence must belong to the same Deep Research Run.',
        false,
        { runId: input.runId, claimId: input.claimId, evidenceId: input.evidenceId },
      )
    }
    return this.options.reportRepo.upsertCitation(input)
  }
}
