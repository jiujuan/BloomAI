import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import type {
  ResearchCitationDto,
  ResearchClaimDto,
  ResearchEvidenceDto,
  ResearchQualityDto,
  ResearchQualityGateResultDto,
  ResearchQuestionDto,
  ResearchReportSectionDto,
  ResearchRunDto,
  ResearchSourceDto,
  ResearchSourceSnapshotDto,
} from '@shared/deepresearch/contracts'
import { parseResearchQualityGatePolicy, type ResearchQualityGatePolicy } from '@server/deepresearch/domain/quality-policy'
import { getResearchProfilePolicy } from '@server/deepresearch/domain/profiles'
import { settingsRepo } from '@server/db/repositories/settings.repo'
import { isQuestionCovered } from '@server/services/deepresearch/evidence-service'
import type { DeepResearchRepositories } from '../workflow-context'
import { checkpointWorkflowPhase } from './checkpoint-replay'
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

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : Math.round((numerator / denominator) * 100) / 100
}

function isSemanticallySupported(citation: ResearchCitationDto): boolean {
  return citation.entailmentStatus === 'supported' && citation.verificationMethod === 'semantic_llm'
}

function makeGate(
  ruleId: string,
  actual: number | string,
  threshold: number | string | null,
  passed: boolean,
  affectedIds: string[],
  remedialAction: string,
  blocking = true,
): ResearchQualityGateResultDto {
  return { ruleId, actual, threshold, passed, blocking, affectedIds, remedialAction }
}

function normalizedTokens(value: string): Set<string> {
  const normalized = value
    .replace(/^#{1,6}\s+.*$/gm, '')
    .toLowerCase()
  const tokens = normalized.match(/[a-z0-9]{3,}|[\u4e00-\u9fff]{2}/g) ?? []
  return new Set(tokens)
}

function similarity(left: string, right: string): number {
  const leftTokens = normalizedTokens(left)
  const rightTokens = normalizedTokens(right)
  if (!leftTokens.size || !rightTokens.size) return 0
  let intersection = 0
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1
  return Math.round((intersection / (leftTokens.size + rightTokens.size - intersection)) * 100) / 100
}

function sourceForCitation(
  citation: ResearchCitationDto,
  evidence: Map<string, ResearchEvidenceDto>,
  snapshots: Map<string, ResearchSourceSnapshotDto>,
  sources: Map<string, ResearchSourceDto>,
): ResearchSourceDto | undefined {
  const item = evidence.get(citation.evidenceId)
  return item ? sources.get(item.sourceId ?? snapshots.get(item.snapshotId)?.sourceId ?? '') : undefined
}

function hasExplicitDisclosure(input: ReportQualityInput, requirement: string): boolean {
  const limitationSections = input.sections.filter((section) => /limitation|限制|局限/i.test(section.title + ' ' + (section.sectionKey ?? '')))
  const text = [
    ...input.claims.filter((claim) => claim.kind === 'limitation').map((claim) => claim.text),
    ...limitationSections.map((section) => section.verifiedText ?? section.draft ?? ''),
    ...input.sections.flatMap((section) => [
      ...(section.draftPayload?.limitations ?? []),
      ...(section.draftPayload?.missingEvidence ?? []),
    ]),
  ].join(' ').toLowerCase()
  const escapedRequirement = requirement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase()
  return new RegExp('(missing|insufficient|unavailable|limitation|disclos|缺少|不足|无法|局限)[^.。]{0,180}' + escapedRequirement + '|' + escapedRequirement + '[^.。]{0,180}(missing|insufficient|unavailable|limitation|disclos|缺少|不足|无法|局限)', 'i').test(text)
}

function keySections(input: ReportQualityInput): ResearchReportSectionDto[] {
  const keyIds = new Set(input.claims
    .filter((claim) => claim.kind === 'factual' && (claim.importance === 'high' || claim.importance === 'critical'))
    .map((claim) => claim.sectionId))
  const selected = input.sections.filter((section) => keyIds.has(section.id))
  return selected.length
    ? selected
    : input.sections.filter((section) => !/^(references|limitations)$/i.test(section.title) && !/(references|limitations)/i.test(section.sectionKey ?? ''))
}

export function assessReportQuality(input: ReportQualityInput, policy: ResearchQualityGatePolicy = parseResearchQualityGatePolicy(null, input.run.profile)): ResearchQualityDto {
  const citationsByClaim = new Map<string, ResearchCitationDto[]>()
  for (const citation of input.citations) citationsByClaim.set(citation.claimId, [...(citationsByClaim.get(citation.claimId) ?? []), citation])
  const snapshots = new Map(input.snapshots.map((snapshot) => [snapshot.id, snapshot]))
  const sources = new Map(input.sources.map((source) => [source.id, source]))
  const evidence = new Map(input.evidence.map((item) => [item.id, item]))
  const sourceFor = (citation: ResearchCitationDto) => sourceForCitation(citation, evidence, snapshots, sources)

  const highPriority = input.questions.filter((question) => question.priority === 'high' || question.priority === 'critical')
  const highPriorityQuestionCoverage = ratio(highPriority.filter(isQuestionCovered).length, highPriority.length)
  const factualClaims = input.claims.filter((claim) => claim.kind === 'factual')
  const keyClaims = factualClaims.filter((claim) => claim.importance === 'high' || claim.importance === 'critical')
  const factualClaimCitationCoverage = ratio(factualClaims.filter((claim) => (citationsByClaim.get(claim.id) ?? []).length > 0).length, factualClaims.length)
  const supportedCitationCoverage = ratio(input.citations.filter(isSemanticallySupported).length, input.citations.length)
  const keyClaimCitationValidity = ratio(keyClaims.filter((claim) => (citationsByClaim.get(claim.id) ?? []).some(isSemanticallySupported)).length, keyClaims.length)
  const citedDomains = new Set(input.citations.filter(isSemanticallySupported).flatMap((citation) => {
    const source = sourceFor(citation)
    return source ? [source.domain] : []
  }))
  const contradictionEvidence = input.evidence.filter((item) => item.stance === 'contradicting')
  const limitationText = input.claims.filter((claim) => claim.kind === 'limitation').map((claim) => claim.text).join(' ').toLowerCase()
  const contradictionDisclosureCoverage = contradictionEvidence.length === 0 || /contradict|conflict|disagree|uncertain|limitation|矛盾|冲突|不确定|局限/.test(limitationText) ? 1 : 0
  const required = getResearchProfilePolicy(input.run.profile).requiredSections
  const completedTitles = new Set(input.sections.filter((section) => (section.status === 'verified' || section.status === 'limited') && Boolean((section.verifiedText ?? section.draft)?.trim())).map((section) => section.title))
  const requiredSectionCoverage = ratio(required.filter((title) => completedTitles.has(title)).length, required.length)
  const gates: ResearchQualityGateResultDto[] = []

  gates.push(makeGate(
    'high_priority_coverage', highPriorityQuestionCoverage, policy.highPriorityCoverageThreshold,
    highPriorityQuestionCoverage >= policy.highPriorityCoverageThreshold,
    highPriority.filter((question) => !isQuestionCovered(question)).map((question) => question.id),
    'Run targeted gap-fill queries for each uncovered high-priority question and bind the resulting evidence to its section.',
  ))
  gates.push(makeGate(
    'factual_claim_citation_coverage', factualClaimCitationCoverage, policy.factualClaimCitationThreshold,
    factualClaimCitationCoverage >= policy.factualClaimCitationThreshold,
    factualClaims.filter((claim) => !(citationsByClaim.get(claim.id) ?? []).length).map((claim) => claim.id),
    'Add bounded evidence citations for factual claims or rewrite unsupported claims as explicit limitations.',
  ))
  gates.push(makeGate(
    'key_claim_citation_validity', keyClaimCitationValidity, policy.keyClaimCitationValidityThreshold,
    keyClaimCitationValidity >= policy.keyClaimCitationValidityThreshold,
    keyClaims.filter((claim) => !(citationsByClaim.get(claim.id) ?? []).some(isSemanticallySupported)).map((claim) => claim.id),
    'Verify every high-importance factual claim with the configured semantic citation model, or remove it from the formal report.',
  ))

  const key = keySections(input)
  const shortSections = key.filter((section) => (section.verifiedText ?? section.draft ?? '').trim().length < policy.minKeySectionLength)
  gates.push(makeGate(
    'key_section_minimum_length', key.length ? Math.min(...key.map((section) => (section.verifiedText ?? section.draft ?? '').trim().length)) : 0, policy.minKeySectionLength,
    shortSections.length === 0,
    shortSections.map((section) => section.id),
    'Develop each key section with a direct answer, evidence basis, and explicit conditions or limitations.',
  ))
  const sectionDomains = new Map(key.map((section) => [section.id, new Set<string>()]))
  for (const citation of input.citations.filter(isSemanticallySupported)) {
    const claim = input.claims.find((item) => item.id === citation.claimId)
    const domain = sourceFor(citation)?.domain
    if (claim && domain) sectionDomains.get(claim.sectionId)?.add(domain)
  }
  const thinDomainSections = key.filter((section) => (sectionDomains.get(section.id)?.size ?? 0) < policy.minIndependentDomainsPerKeySection)
  gates.push(makeGate(
    'key_section_independent_domains', key.length ? Math.min(...key.map((section) => sectionDomains.get(section.id)?.size ?? 0)) : 0, policy.minIndependentDomainsPerKeySection,
    thinDomainSections.length === 0,
    thinDomainSections.map((section) => section.id),
    'Add semantically verified evidence from independent domains to the affected key sections.',
  ))

  let maximumSimilarity = 0
  const similarSectionIds = new Set<string>()
  for (let index = 0; index < key.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < key.length; otherIndex += 1) {
      const score = similarity(key[index].verifiedText ?? key[index].draft ?? '', key[otherIndex].verifiedText ?? key[otherIndex].draft ?? '')
      maximumSimilarity = Math.max(maximumSimilarity, score)
      if (score > policy.maxSectionSimilarity) {
        similarSectionIds.add(key[index].id)
        similarSectionIds.add(key[otherIndex].id)
      }
    }
  }
  gates.push(makeGate(
    'section_similarity', maximumSimilarity, policy.maxSectionSimilarity,
    maximumSimilarity <= policy.maxSectionSimilarity,
    [...similarSectionIds],
    'Rewrite overlapping sections so each answers its mapped questions with distinct conclusions and evidence.',
  ))

  const unmetRequirements: string[] = []
  const recentCutoff = Date.now() - 2 * 365 * 24 * 60 * 60 * 1000
  for (const question of input.questions) {
    const questionCitations = input.citations.filter((citation) => evidence.get(citation.evidenceId)?.questionId === question.id && isSemanticallySupported(citation))
    const questionSources = questionCitations.map(sourceFor).filter((source): source is ResearchSourceDto => Boolean(source))
    for (const type of question.requiredEvidenceTypes) {
      if (!questionSources.some((source) => source.sourceType === type) && !hasExplicitDisclosure(input, type)) unmetRequirements.push(question.id + ':source-type:' + type)
    }
    if (question.needRecentSource && !questionSources.some((source) => source.publishedAt !== null && source.publishedAt >= recentCutoff) && !hasExplicitDisclosure(input, 'recent')) {
      unmetRequirements.push(question.id + ':recent-source')
    }
  }
  gates.push(makeGate(
    'required_source_type_or_disclosure', unmetRequirements.length ? unmetRequirements.join(', ') : 'satisfied', 'required types/current sources or disclosure',
    unmetRequirements.length === 0,
    unmetRequirements.map((item) => item.split(':')[0]),
    'Acquire the required source type or recent source for each affected question, or disclose the unavailable requirement in the report limitations.',
  ))

  const keyCitations = keyClaims.flatMap((claim) => citationsByClaim.get(claim.id) ?? [])
  const unavailableCitationIds = keyCitations.filter((citation) => citation.verificationMethod !== 'semantic_llm').map((citation) => citation.id)
  const verificationCapabilityPassed = keyClaims.length === 0 || (keyCitations.length > 0 && unavailableCitationIds.length === 0)
  gates.push(makeGate(
    'citation_verification_capability', verificationCapabilityPassed ? 'semantic_llm_available' : 'semantic_llm_unavailable', 'semantic_llm', verificationCapabilityPassed,
    unavailableCitationIds.length ? unavailableCitationIds : keyClaims.filter((claim) => !(citationsByClaim.get(claim.id) ?? []).length).map((claim) => claim.id),
    'Restore the configured semantic citation verifier and re-verify affected claims; conservative structural checks cannot authorize formal publication.',
  ))
  gates.push(makeGate(
    'contradiction_disclosure', contradictionDisclosureCoverage, 1, contradictionDisclosureCoverage === 1,
    contradictionDisclosureCoverage === 1 ? contradictionEvidence.map((item) => item.id) : [],
    'State contradictory evidence and the resulting uncertainty in the report limitations.',
  ))
  gates.push(makeGate(
    'required_sections', requiredSectionCoverage, 1, requiredSectionCoverage === 1,
    required.filter((title) => !completedTitles.has(title)),
    'Complete every required report section before formal publication.',
  ))
  const deadlineExceeded = input.run.usage.deadlineAt !== null && input.run.usage.deadlineAt <= Date.now()
  gates.push(makeGate(
    'research_deadline', deadlineExceeded ? 'exceeded' : 'within_budget', 'within_budget', !deadlineExceeded, [],
    'Resume research with additional time budget and execute the highest-value gap queries.',
  ))

  const unsupportedImportant = keyClaims.filter((claim) => claim.verificationStatus === 'unsupported')
  if (unsupportedImportant.length) gates.push(makeGate(
    'unsupported_important_claims', unsupportedImportant.length, 0, false, unsupportedImportant.map((claim) => claim.id),
    'Remove or rewrite unsupported high-importance claims and obtain direct bounded evidence before publishing.',
  ))

  const failures = gates.filter((gate) => !gate.passed)
  const limitations = failures.map((gate) => gate.ruleId + ': actual=' + String(gate.actual) + ', threshold=' + String(gate.threshold) + '. ' + gate.remedialAction)
  const remedialActions = [...new Set(failures.map((gate) => gate.remedialAction))]
  const verifierUnavailable = failures.some((gate) => gate.ruleId === 'citation_verification_capability')
  const releaseStatus = unsupportedImportant.length || verifierUnavailable || (!policy.allowLimitedPublication && failures.some((gate) => gate.blocking))
    ? 'failed'
    : failures.some((gate) => gate.blocking)
      ? 'completed_with_limitations'
      : 'completed'

  return {
    releaseStatus,
    highPriorityQuestionCoverage,
    factualClaimCitationCoverage,
    supportedCitationCoverage,
    independentCitedDomainCount: citedDomains.size,
    contradictionDisclosureCoverage,
    requiredSectionCoverage,
    limitations,
    assessorVersion: 'deep-research-quality-v2',
    policyVersion: policy.version,
    gateResults: gates,
    remedialActions,
  }
}

export function createAssessQualityStep(repositories: DeepResearchRepositories) {
  return createStep({
    id: 'deep-research-assess-quality',
    inputSchema: z.object({ runId: z.string().min(1) }),
    outputSchema: z.object({ runId: z.string().min(1) }),
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['verifying'])
      const policy = parseResearchQualityGatePolicy(settingsRepo.getValue('deep_research_quality_gates'), run.profile)
      const quality = assessReportQuality({
        run,
        questions: repositories.researchQuestionRepo.list(run.id),
        sections: repositories.researchReportRepo.listSections(run.id),
        claims: repositories.researchReportRepo.listClaims(run.id),
        citations: repositories.researchReportRepo.listCitations(run.id),
        evidence: repositories.researchEvidenceRepo.list(run.id),
        sources: repositories.researchSourceRepo.listSources(run.id),
        snapshots: repositories.researchSourceRepo.listSnapshots(run.id),
      }, policy)
      repositories.researchReportRepo.createQuality(run.id, quality)
      repositories.researchRunRepo.setQuality(run.id, quality)
      repositories.researchEventRepo.append({ runId: run.id, type: 'research.quality.assessed', phase: 'assessing_quality', payload: { releaseStatus: quality.releaseStatus, policyVersion: quality.policyVersion ?? null, failedRules: quality.gateResults?.filter((gate) => !gate.passed).map((gate) => gate.ruleId) ?? [] } })
      checkpointWorkflowPhase(repositories, run, 'assessing_quality', 'finalizing_artifacts')
      return { runId: run.id }
    },
  })
}
