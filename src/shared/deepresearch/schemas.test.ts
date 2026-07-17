import { describe, expect, it } from 'vitest'
import {
  clarificationSchema,
  researchCoverageSchema,
  researchEventSchema,
  researchRunDtoSchema,
  startResearchSchema,
} from './schemas'

const legacyRun = {
  id: 'run-1',
  sessionId: null,
  topic: 'Enterprise AI assistant market',
  profile: 'market',
  depth: 'deep',
  status: 'interrupted',
  phase: 'researching',
  progress: 42,
  brief: null,
  workflowRunId: null,
  budget: {
    maxQuestions: 10,
    maxIterations: 2,
    maxSearchQueries: 20,
    maxNormalizedSources: 50,
    maxFetchedSources: 20,
    searchConcurrency: 2,
    fetchConcurrency: 2,
    maxDurationMs: 60_000,
  },
  usage: {
    questions: 1,
    iterations: 0,
    searchQueries: 2,
    normalizedSources: 2,
    fetchedSources: 1,
    tokens: 0,
    providerCostUsd: 0,
    startedAt: 1,
    deadlineAt: null,
  },
  quality: null,
  reportArtifactId: null,
  resumePhase: 'researching',
  error: null,
  createdAt: 1,
  updatedAt: 2,
  completedAt: null,
}

describe('deep research schemas', () => {
  it('normalizes a valid research start request', () => {
    const result = startResearchSchema.parse({
      topic: '  Enterprise AI assistant market  ',
      profile: 'market',
      depth: 'deep',
      geography: [' United States '],
    })

    expect(result).toMatchObject({
      topic: 'Enterprise AI assistant market',
      profile: 'market',
      depth: 'deep',
      geography: ['United States'],
    })
  })

  it('rejects invalid research input and empty clarification answers', () => {
    expect(startResearchSchema.safeParse({ topic: 'x', profile: 'invalid', depth: 'deep' }).success).toBe(false)
    expect(clarificationSchema.safeParse({ clarificationId: 'clarification-1', answer: '   ' }).success).toBe(false)
  })

  it('parses a legacy Run DTO and projects its resume phase into a V2 cursor and capabilities', () => {
    const parsed = researchRunDtoSchema.parse(legacyRun)

    expect(parsed.checkpointCursor).toEqual({ version: 1, nextPhase: 'researching', iteration: 0 })
    expect(parsed.capabilities).toEqual({
      canCancel: true,
      canResume: true,
      canRetry: false,
      canProvideClarification: false,
    })
    expect(parsed.execution).toBeNull()
    expect(parsed.cancellation).toBeNull()
  })

  it('accepts V2 retryable failure fields while keeping legacy fields intact', () => {
    const parsed = researchRunDtoSchema.parse({
      ...legacyRun,
      status: 'failed',
      resumePhase: null,
      error: { code: 'RESEARCH_PROVIDER_TIMEOUT', message: 'Timed out', retryable: true, category: 'timeout' },
      checkpointCursor: { version: 1, nextPhase: 'assessing_coverage', iteration: 2, pendingQueryIds: ['query-1'] },
      execution: {
        attempt: {
          id: 'attempt-2',
          runId: 'run-1',
          ordinal: 2,
          trigger: 'retry',
          status: 'failed',
          workflowRunId: null,
          executorId: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          startCheckpointKey: 'iteration:2:coverage_assessed',
          endCheckpointKey: null,
          error: { code: 'RESEARCH_PROVIDER_TIMEOUT', message: 'Timed out', retryable: true, category: 'timeout' },
          startedAt: 2,
          endedAt: 3,
          createdAt: 2,
        },
      },
      latestCheckpoint: {
        id: 'checkpoint-1',
        runId: 'run-1',
        attemptId: 'attempt-2',
        sequence: 6,
        checkpointKey: 'iteration:2:coverage_assessed',
        phase: 'assessing_coverage',
        status: 'completed',
        resumeCursor: { version: 1, nextPhase: 'assessing_coverage', iteration: 2 },
        inputFingerprint: 'input-1',
        outputFingerprint: null,
        replayPolicy: 'reuse',
        createdAt: 3,
      },
      cancellation: { requestedAt: null, reason: null },
    })

    expect(parsed.error?.category).toBe('timeout')
    expect(parsed.capabilities).toMatchObject({ canResume: true, canRetry: true, canCancel: false })
    expect(parsed.checkpointCursor?.nextPhase).toBe('assessing_coverage')
  })

  it('keeps V1 coverage and event payloads parseable when V2 fields are absent', () => {
    expect(researchCoverageSchema.parse({
      questionId: 'question-1',
      score: 0.8,
      independentDomainCount: 2,
      evidenceCategories: ['primary'],
      primarySourceCount: 1,
      recentSourceCount: 1,
      supportingEvidenceCount: 2,
      contradictingEvidenceCount: 0,
      hasSingleSourceDependency: false,
      gaps: [],
    })).toMatchObject({ questionId: 'question-1', score: 0.8 })

    expect(researchEventSchema.parse({
      runId: 'run-1',
      sequence: 3,
      type: 'research.run.failed',
      phase: 'researching',
      timestamp: 3,
      payload: { errorCode: 'RESEARCH_PROVIDER_TIMEOUT', retryable: true },
    })).toMatchObject({ type: 'research.run.failed' })
  })
})
