import { describe, expect, it } from 'vitest'
import type { ResearchCheckpointCursorDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import {
  DEEP_RESEARCH_WORKFLOW_VERSION,
  createCheckpointCursor,
  createCheckpointReplayFingerprint,
  resolveCheckpointReplay,
} from './checkpoint-replay'

const run = {
  id: 'run-1',
  profile: 'market',
  depth: 'deep',
  usage: { iterations: 1 },
} as unknown as ResearchRunDto

function entities(overrides: Partial<Record<string, boolean>> = {}) {
  return {
    brief: true,
    questions: true,
    queries: true,
    searchedQueries: true,
    sources: true,
    snapshots: true,
    evidence: true,
    coverageAssessment: true,
    iterationDecision: true,
    outline: true,
    draftedSections: true,
    claims: true,
    verifiedCitations: true,
    quality: true,
    artifact: true,
    ...overrides,
  }
}

describe('checkpoint cursor replay rules', () => {
  it('reuses a compatible cursor only when all DB entities before its next phase are complete', () => {
    const cursor = createCheckpointCursor(run, 'building_outline', 1)
    const result = resolveCheckpointReplay({ run, cursor, entities: entities() })

    expect(result).toEqual({ cursor, reused: true, reason: null })
  })

  it('falls back to the smallest safe phase when a cursor points past missing durable evidence', () => {
    const cursor = createCheckpointCursor(run, 'assessing_coverage', 1)
    const result = resolveCheckpointReplay({ run, cursor, entities: entities({ evidence: false }) })

    expect(result.reused).toBe(false)
    expect(result.cursor.nextPhase).toBe('extracting_evidence')
    expect(result.reason).toBe('missing_evidence')
  })

  it('rejects an incompatible workflow/profile/policy cursor and conservatively restarts planning', () => {
    const cursor: ResearchCheckpointCursorDto = {
      ...createCheckpointCursor(run, 'finalizing_artifacts', 1),
      workflowVersion: 'deep-research-v0',
    }
    const result = resolveCheckpointReplay({ run, cursor, entities: entities() })

    expect(DEEP_RESEARCH_WORKFLOW_VERSION).toBe('deep-research-v1')
    expect(result).toMatchObject({
      reused: false,
      reason: 'incompatible_cursor',
      cursor: { nextPhase: 'planning', workflowVersion: DEEP_RESEARCH_WORKFLOW_VERSION },
    })
  })

  it('rejects an unknown phase even when the cursor metadata otherwise matches', () => {
    const cursor = { ...createCheckpointCursor(run, 'searching'), nextPhase: 'future_mastra_only_phase' }
    const result = resolveCheckpointReplay({ run, cursor, entities: entities() })

    expect(result).toMatchObject({
      reused: false,
      reason: 'incompatible_cursor',
      cursor: { nextPhase: 'planning' },
    })
  })
  it('uses a stable run/profile/policy compatibility fingerprint rather than Mastra workflow state', () => {
    expect(createCheckpointReplayFingerprint(run)).toBe('deep-research-replay:v1:workflow:deep-research-v1:run:run-1:profile:market:policy:v2')
  })
})