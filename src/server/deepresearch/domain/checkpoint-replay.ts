import type { ResearchCheckpointCursorDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import { COVERAGE_POLICY_V2_VERSION } from './coverage-policy'

export const DEEP_RESEARCH_WORKFLOW_VERSION = 'deep-research-v1' as const

export type CheckpointReplayEntity =
  | 'brief'
  | 'questions'
  | 'queries'
  | 'searchedQueries'
  | 'sources'
  | 'snapshots'
  | 'evidence'
  | 'coverageAssessment'
  | 'iterationDecision'
  | 'outline'
  | 'draftedSections'
  | 'claims'
  | 'verifiedCitations'
  | 'quality'
  | 'artifact'

export interface CheckpointReplayEntities extends Record<CheckpointReplayEntity, boolean> {}

export interface CheckpointReplayResolution {
  cursor: ResearchCheckpointCursorDto
  reused: boolean
  reason: 'incompatible_cursor' | `missing_${string}` | null
}

const phaseRequirements: ReadonlyArray<readonly [string, readonly CheckpointReplayEntity[]]> = [
  ['planning', []],
  ['plan_questions', ['brief']],
  ['plan_queries', ['brief', 'questions']],
  ['searching', ['brief', 'questions', 'queries']],
  ['curating_sources', ['brief', 'questions', 'queries', 'searchedQueries']],
  ['fetching', ['brief', 'questions', 'queries', 'searchedQueries', 'sources']],
  ['extracting_evidence', ['brief', 'questions', 'queries', 'searchedQueries', 'sources', 'snapshots']],
  ['assessing_coverage', ['brief', 'questions', 'queries', 'searchedQueries', 'sources', 'snapshots', 'evidence']],
  ['gap_filling', ['brief', 'questions', 'queries', 'searchedQueries', 'sources', 'snapshots', 'evidence', 'coverageAssessment']],
  ['building_outline', ['brief', 'questions', 'queries', 'searchedQueries', 'sources', 'snapshots', 'evidence', 'coverageAssessment', 'iterationDecision']],
  ['drafting_sections', ['brief', 'questions', 'queries', 'searchedQueries', 'sources', 'snapshots', 'evidence', 'coverageAssessment', 'iterationDecision', 'outline']],
  ['extracting_claims', ['brief', 'questions', 'queries', 'searchedQueries', 'sources', 'snapshots', 'evidence', 'coverageAssessment', 'iterationDecision', 'outline', 'draftedSections']],
  ['verifying_citations', ['brief', 'questions', 'queries', 'searchedQueries', 'sources', 'snapshots', 'evidence', 'coverageAssessment', 'iterationDecision', 'outline', 'draftedSections', 'claims']],
  ['repair_report', ['brief', 'questions', 'queries', 'searchedQueries', 'sources', 'snapshots', 'evidence', 'coverageAssessment', 'iterationDecision', 'outline', 'draftedSections', 'claims', 'verifiedCitations']],
  ['assessing_quality', ['brief', 'questions', 'queries', 'searchedQueries', 'sources', 'snapshots', 'evidence', 'coverageAssessment', 'iterationDecision', 'outline', 'draftedSections', 'claims', 'verifiedCitations']],
  ['finalizing_artifacts', ['brief', 'questions', 'queries', 'searchedQueries', 'sources', 'snapshots', 'evidence', 'coverageAssessment', 'iterationDecision', 'outline', 'draftedSections', 'claims', 'verifiedCitations', 'quality']],
  ['completed', ['brief', 'questions', 'queries', 'searchedQueries', 'sources', 'snapshots', 'evidence', 'coverageAssessment', 'iterationDecision', 'outline', 'draftedSections', 'claims', 'verifiedCitations', 'quality', 'artifact']],
]

function cursorMetadata(run: ResearchRunDto) {
  return {
    workflowVersion: DEEP_RESEARCH_WORKFLOW_VERSION,
    profile: run.profile,
    policyVersion: COVERAGE_POLICY_V2_VERSION,
    compatibilityFingerprint: createCheckpointReplayFingerprint(run),
  }
}

export function createCheckpointReplayFingerprint(run: ResearchRunDto): string {
  return `deep-research-replay:v1:workflow:${DEEP_RESEARCH_WORKFLOW_VERSION}:run:${run.id}:profile:${run.profile}:policy:${COVERAGE_POLICY_V2_VERSION}`
}

export function createCheckpointCursor(run: ResearchRunDto, nextPhase: string, iteration = run.usage.iterations): ResearchCheckpointCursorDto {
  return { version: 1, nextPhase, iteration, ...cursorMetadata(run) }
}

function requirementsFor(phase: string): readonly CheckpointReplayEntity[] {
  return phaseRequirements.find(([candidate]) => candidate === phase)?.[1] ?? []
}

function smallestSafeCursor(run: ResearchRunDto, entities: CheckpointReplayEntities): ResearchCheckpointCursorDto {
  let lastSafePhase = 'planning'
  for (const [phase, requirements] of phaseRequirements) {
    if (!requirements.every((entity) => entities[entity])) break
    lastSafePhase = phase
  }
  return createCheckpointCursor(run, lastSafePhase, run.usage.iterations)
}

export function resolveCheckpointReplay(input: {
  run: ResearchRunDto
  cursor: ResearchCheckpointCursorDto | null | undefined
  entities: CheckpointReplayEntities
}): CheckpointReplayResolution {
  const { run, cursor, entities } = input
  if (!cursor
    || !phaseRequirements.some(([phase]) => phase === cursor.nextPhase)
    || cursor.workflowVersion !== DEEP_RESEARCH_WORKFLOW_VERSION
    || cursor.profile !== run.profile
    || cursor.policyVersion !== COVERAGE_POLICY_V2_VERSION
    || cursor.compatibilityFingerprint !== createCheckpointReplayFingerprint(run)) {
    return { cursor: createCheckpointCursor(run, 'planning', run.usage.iterations), reused: false, reason: 'incompatible_cursor' }
  }

  const missing = requirementsFor(cursor.nextPhase).find((entity) => !entities[entity])
  if (!missing) return { cursor, reused: true, reason: null }

  return { cursor: smallestSafeCursor(run, entities), reused: false, reason: `missing_${missing}` }
}