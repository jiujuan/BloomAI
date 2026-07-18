import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResearchCoverageAssessmentV2Dto, ResearchCoverageDto } from '@shared/deepresearch/contracts'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadRepositories() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../../client')
  await client.runMigrations()
  const { researchRunRepo } = await import('./research-run.repo')
  const { researchAttemptRepo } = await import('./research-attempt.repo')
  const { researchQuestionRepo } = await import('./research-question.repo')
  const { researchCoverageAssessmentRepo } = await import('./research-coverage-assessment.repo')
  const { researchCheckpointRepo } = await import('./research-checkpoint.repo')
  const { researchEventRepo } = await import('./research-event.repo')
  return { client, researchRunRepo, researchAttemptRepo, researchQuestionRepo, researchCoverageAssessmentRepo, researchCheckpointRepo, researchEventRepo }
}

function budget() {
  return {
    maxQuestions: 14, maxIterations: 3, maxSearchQueries: 48, maxNormalizedSources: 50, maxFetchedSources: 36,
    searchConcurrency: 6, fetchConcurrency: 5, maxDurationMs: 30 * 60 * 1000,
  }
}

function assessment(questionId: string, overrides: Partial<ResearchCoverageAssessmentV2Dto> = {}): ResearchCoverageAssessmentV2Dto {
  return {
    policyVersion: 'v2', profile: 'market', questionId, inputFingerprint: 'question-input', score: 0.3, verdict: 'limited',
    dimensions: { evidenceSufficiency: 0.3, independentCorroboration: 0, authority: 0.5, recency: 1, requiredEvidenceTypes: 1, contradictionHandling: 1 },
    sourceCounts: { evidence: 1, distinctSources: 1, independentDomains: 1, primaryOrAuthoritative: 1, recent: 1 },
    support: { supporting: 1, contradicting: 0, contextual: 0 },
    gaps: [{ code: 'SINGLE_DOMAIN', severity: 'high', remediable: true, remediation: 'search_independent', recommendedSearchIntent: 'independent corroboration' }],
    limitation: 'Only one independent domain supports this answer.', suggestedSearchIntents: ['independent corroboration'], materialGain: null,
    assessedAt: 1000,
    ...overrides,
  }
}

function projection(questionId: string, score = 0.3): ResearchCoverageDto {
  return {
    questionId, score, independentDomainCount: 1, evidenceCategories: ['official-statistics'], primarySourceCount: 1,
    recentSourceCount: 1, supportingEvidenceCount: 1, contradictingEvidenceCount: 0, hasSingleSourceDependency: true,
    gaps: ['Independent corroboration is still required.'],
  }
}

describe('researchCoverageAssessmentRepo.persistAndProject', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-coverage-assessment-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  async function arrange() {
    const repositories = await loadRepositories()
    const run = repositories.researchRunRepo.create({
      input: { topic: 'Enterprise AI assistant market', profile: 'market', depth: 'deep' }, budget: budget(),
    })
    const question = repositories.researchQuestionRepo.create({
      runId: run.id, ordinal: 1, question: 'How quickly is the market growing?', intent: 'growth',
      requiredEvidenceTypes: ['official-statistics'], priority: 'high', status: 'researching',
    })
    const { attempt } = repositories.researchAttemptRepo.createWithInitialCheckpoint({
      runId: run.id, trigger: 'initial', checkpoint: {
        checkpointKey: 'planning:complete', phase: 'planning', status: 'completed',
        resumeCursor: { version: 1 as const, nextPhase: 'assessing_coverage', iteration: 0 },
        inputFingerprint: 'planning-complete', replayPolicy: 'reuse',
      },
    })
    return { ...repositories, run, question, attempt }
  }

  function input(runId: string, attemptId: string, questionId: string, fingerprint = 'assessment-input-1', score = 0.3) {
    const item = assessment(questionId, { score })
    return {
      runId, attemptId, iterationId: null, iteration: 0, policyVersion: 'v2' as const, inputFingerprint: fingerprint,
      aggregateScore: score, questionAssessments: [item], coverageProjections: [projection(questionId, score)],
      limitations: [item.limitation!], checkpoint: {
        checkpointKey: 'coverage:assessment', phase: 'assessing_coverage', status: 'completed' as const,
        resumeCursor: { version: 1 as const, nextPhase: 'gap_filling', iteration: 0 }, inputFingerprint: fingerprint,
        outputFingerprint: 'coverage-output-' + fingerprint, replayPolicy: 'reuse' as const,
      }, createdAt: 1000,
    }
  }

  it('does not project a question when assessment storage fails', async () => {
    const { researchCoverageAssessmentRepo, researchQuestionRepo, researchEventRepo, researchCheckpointRepo, run, attempt, question } = await arrange()
    researchCoverageAssessmentRepo.persistAndProject({
      ...input(run.id, attempt.id, question.id),
      id: 'assessment-storage-conflict',
    })
    const unprojectedQuestion = researchQuestionRepo.create({
      runId: run.id, ordinal: 2, question: 'What does adoption look like?', intent: 'adoption',
      requiredEvidenceTypes: ['official-statistics'], priority: 'high', status: 'researching',
    })

    expect(() => researchCoverageAssessmentRepo.persistAndProject({
      ...input(run.id, attempt.id, unprojectedQuestion.id, 'assessment-input-2', 0.91),
      id: 'assessment-storage-conflict',
    })).toThrow()

    expect(researchQuestionRepo.get(unprojectedQuestion.id)?.coverage).toBeNull()
    expect(researchCoverageAssessmentRepo.list(run.id)).toHaveLength(1)
    expect(researchEventRepo.list(run.id).filter((event) => event.type === 'research.coverage.assessment_completed')).toHaveLength(1)
    expect(researchCheckpointRepo.list(run.id).filter((checkpoint) => checkpoint.checkpointKey === 'coverage:assessment')).toHaveLength(1)
  })

  it('deduplicates matching fingerprints without duplicate projection event or checkpoint', async () => {
    const { researchCoverageAssessmentRepo, researchEventRepo, researchCheckpointRepo, run, attempt, question } = await arrange()
    const first = researchCoverageAssessmentRepo.persistAndProject(input(run.id, attempt.id, question.id))
    const second = researchCoverageAssessmentRepo.persistAndProject(input(run.id, attempt.id, question.id))

    expect(second.assessment.id).toBe(first.assessment.id)
    expect(second.created).toBe(false)
    expect(researchEventRepo.list(run.id).filter((event) => event.type === 'research.coverage.assessment_completed')).toHaveLength(1)
    expect(researchCheckpointRepo.list(run.id).filter((checkpoint) => checkpoint.checkpointKey === 'coverage:assessment')).toHaveLength(1)
  })

  it('projects the newest full V2 assessment into the V1 question coverage and detail audit record', async () => {
    const { researchCoverageAssessmentRepo, researchQuestionRepo, researchRunRepo, researchEventRepo, researchCheckpointRepo, run, attempt, question } = await arrange()
    researchCoverageAssessmentRepo.persistAndProject(input(run.id, attempt.id, question.id, 'assessment-input-1', 0.3))
    const secondInput = {
      ...input(run.id, attempt.id, question.id, 'assessment-input-2', 0.91),
      questionAssessments: [assessment(question.id, {
        score: 0.91,
        verdict: 'blocked',
        gaps: [{
          code: 'UNRESOLVED_CONTRADICTION',
          severity: 'critical',
          remediable: true,
          remediation: 'search_counterevidence',
          recommendedSearchIntent: 'find independent counterevidence',
        }],
        limitation: 'Conflicting authoritative evidence remains unresolved.',
        suggestedSearchIntents: ['find independent counterevidence'],
      })],
      limitations: ['Conflicting authoritative evidence remains unresolved.'],
      createdAt: 2000,
    }
    const newest = researchCoverageAssessmentRepo.persistAndProject(secondInput)

    expect(researchQuestionRepo.get(question.id)).toMatchObject({ status: 'limited', coverage: { questionId: question.id, score: 0.91, evidenceCategories: ['official-statistics'] } })
    expect(newest.assessment).toMatchObject({
      attemptId: attempt.id,
      iterationId: null,
      questionAssessments: [expect.objectContaining({
        questionId: question.id,
        score: 0.91,
        verdict: 'blocked',
        gaps: [expect.objectContaining({ code: 'UNRESOLVED_CONTRADICTION', remediation: 'search_counterevidence' })],
        limitation: 'Conflicting authoritative evidence remains unresolved.',
      })],
      coverageProjections: [expect.objectContaining({ questionId: question.id, score: 0.91 })],
      limitations: ['Conflicting authoritative evidence remains unresolved.'],
    })
    const detail = researchRunRepo.getDetail(run.id)!
    expect(detail.questions[0].coverage).toEqual(newest.assessment.coverageProjections[0])
    expect(detail.coverageAssessments?.[0]).toMatchObject({
      id: newest.assessment.id,
      questionAssessments: [expect.objectContaining({ gaps: [expect.objectContaining({ code: 'UNRESOLVED_CONTRADICTION' })] })],
    })
    const events = researchEventRepo.list(run.id)
    const completion = events.filter((event) => event.type === 'research.coverage.assessment_completed').at(-1)!
    const gapDetected = events.filter((event) => event.type === 'research.coverage.gap_detected').at(-1)!
    const checkpointEvent = events.filter((event) => event.type === 'research.checkpoint.completed').at(-1)!
    const checkpoint = researchCheckpointRepo.list(run.id).find((item) => item.checkpointKey === 'coverage:assessment')!
    expect(gapDetected.payload).toEqual({ questionId: question.id, gapCodes: ['UNRESOLVED_CONTRADICTION'] })
    expect(completion.sequence).toBeLessThan(checkpointEvent.sequence)
    expect(gapDetected.sequence).toBeLessThan(checkpointEvent.sequence)
    expect(checkpoint.outputFingerprint).toBe('coverage-output-assessment-input-2')
  })
})
