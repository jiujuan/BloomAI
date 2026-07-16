import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import type {
  ResearchCitationDto,
  ResearchClaimDto,
  ResearchEvidenceDto,
  ResearchQuestionDto,
  ResearchQualityDto,
  ResearchReportSectionDto,
  ResearchRunDto,
  ResearchSourceDto,
  ResearchSourceSnapshotDto,
} from '@shared/deepresearch/contracts'
import { getResearchProfilePolicy } from '@server/deepresearch/domain/profiles'
import { isQuestionCovered } from '@server/services/deepresearch/evidence-service'
import type { DeepResearchRepositories } from '../workflow-context'
import { loadRunnableRun } from '../workflow-context'

export interface ReportQualityInput {
  run: ResearchRunDto
  questions: ResearchQuestionDto[]
  sections: ResearchReportSectionDto[]
  claims: ResearchClaimDto[]
  citations: ResearchCitationDto[]
  evidence: ResearchEvidenceDto[]
  sources: ResearchSourceDto[]
  snapshots: ResearchSourceSnapshotDto[]
}

function ratio(numerator: number, denominator: number): number { return denominator === 0 ? 1 : Math.round((numerator / denominator) * 100) / 100 }

export function assessReportQuality(input: ReportQualityInput): ResearchQualityDto {
  const highPriority = input.questions.filter((question) => question.priority === 'high' || question.priority === 'critical')
  const highPriorityQuestionCoverage = ratio(highPriority.filter(isQuestionCovered).length, highPriority.length)
  const factualClaims = input.claims.filter((claim) => claim.kind === 'factual')
  const citationsByClaim = new Map<string, ResearchCitationDto[]>()
  for (const citation of input.citations) citationsByClaim.set(citation.claimId, [...(citationsByClaim.get(citation.claimId) ?? []), citation])
  const factualClaimCitationCoverage = ratio(factualClaims.filter((claim) => (citationsByClaim.get(claim.id) ?? []).length > 0).length, factualClaims.length)
  const supportedCitationCoverage = ratio(input.citations.filter((citation) => citation.entailmentStatus !== 'unsupported').length, input.citations.length)
  const snapshots = new Map(input.snapshots.map((snapshot) => [snapshot.id, snapshot]))
  const sources = new Map(input.sources.map((source) => [source.id, source]))
  const evidence = new Map(input.evidence.map((item) => [item.id, item]))
  const citedDomains = new Set(input.citations.flatMap((citation) => {
    const item = evidence.get(citation.evidenceId)
    const source = item ? sources.get(snapshots.get(item.snapshotId)?.sourceId ?? '') : undefined
    return source ? [source.domain] : []
  }))
  const contradictionEvidence = input.evidence.filter((item) => item.stance === 'contradicting')
  const limitationText = input.claims.filter((claim) => claim.kind === 'limitation').map((claim) => claim.text).join(' ').toLowerCase()
  const contradictionDisclosureCoverage = contradictionEvidence.length === 0 || /contradict|conflict|disagree|uncertain|limitation/.test(limitationText) ? 1 : 0
  const required = getResearchProfilePolicy(input.run.profile).requiredSections
  const completedTitles = new Set(input.sections.filter((section) => (section.status === 'verified' || section.status === 'limited') && Boolean(section.verifiedText?.trim())).map((section) => section.title))
  const requiredSectionCoverage = ratio(required.filter((title) => completedTitles.has(title)).length, required.length)
  const scopeForbidsIndependentDomains = /single[- ](?:source|domain)|one[- ](?:source|domain)/i.test(input.run.brief?.scope ?? '')
  const unsupportedImportant = input.claims.some((claim) => (claim.importance === 'high' || claim.importance === 'critical') && claim.verificationStatus === 'unsupported')
  const limitations: string[] = []
  if (highPriorityQuestionCoverage < 0.8) limitations.push('High-priority research questions remain below the required coverage threshold.')
  if (factualClaimCitationCoverage < 0.9) limitations.push('Some factual claims do not have a bound evidence citation.')
  if (supportedCitationCoverage < 0.9) limitations.push('Some citations were not sufficiently supported by their evidence.')
  if (!scopeForbidsIndependentDomains && citedDomains.size < 3) limitations.push('Fewer than three independent cited domains were available.')
  if (contradictionDisclosureCoverage < 1) limitations.push('Contradictory evidence was not fully disclosed in the limitations.')
  if (requiredSectionCoverage < 1) limitations.push('One or more required report sections were incomplete.')
  if (input.run.usage.deadlineAt !== null && input.run.usage.deadlineAt <= Date.now()) limitations.push('The research time budget was exhausted before all gaps could be resolved.')
  const allGatesPass = limitations.length === 0
  return {
    releaseStatus: unsupportedImportant ? 'failed' : allGatesPass ? 'completed' : 'completed_with_limitations',
    highPriorityQuestionCoverage,
    factualClaimCitationCoverage,
    supportedCitationCoverage,
    independentCitedDomainCount: citedDomains.size,
    contradictionDisclosureCoverage,
    requiredSectionCoverage,
    limitations: unsupportedImportant ? [...limitations, 'An important claim remains unsupported by evidence.'] : limitations,
    assessorVersion: 'deep-research-quality-v1',
  }
}

export function createAssessQualityStep(repositories: DeepResearchRepositories) {
  return createStep({
    id: 'deep-research-assess-quality',
    inputSchema: z.object({ runId: z.string().min(1) }),
    outputSchema: z.object({ runId: z.string().min(1) }),
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['verifying'])
      const quality = assessReportQuality({
        run,
        questions: repositories.researchQuestionRepo.list(run.id),
        sections: repositories.researchReportRepo.listSections(run.id),
        claims: repositories.researchReportRepo.listClaims(run.id),
        citations: repositories.researchReportRepo.listCitations(run.id),
        evidence: repositories.researchEvidenceRepo.list(run.id),
        sources: repositories.researchSourceRepo.listSources(run.id),
        snapshots: repositories.researchSourceRepo.listSnapshots(run.id),
      })
      repositories.researchReportRepo.createQuality(run.id, quality)
      repositories.researchRunRepo.setQuality(run.id, quality)
      repositories.researchEventRepo.append({ runId: run.id, type: 'research.quality.assessed', phase: 'assessing_quality', payload: { releaseStatus: quality.releaseStatus } })
      return { runId: run.id }
    },
  })
}
