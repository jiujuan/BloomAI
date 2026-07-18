import { beforeEach, describe, expect, it, vi } from 'vitest'

const { counters, histograms, meter } = vi.hoisted(() => {
  const counters = new Map<string, { add: ReturnType<typeof vi.fn> }>()
  const histograms = new Map<string, { record: ReturnType<typeof vi.fn> }>()
  return {
    counters,
    histograms,
    meter: {
      createCounter: vi.fn((name: string) => {
        const instrument = { add: vi.fn() }
        counters.set(name, instrument)
        return instrument
      }),
      createHistogram: vi.fn((name: string) => {
        const instrument = { record: vi.fn() }
        histograms.set(name, instrument)
        return instrument
      }),
    },
  }
})

vi.mock('@opentelemetry/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@opentelemetry/api')>()),
  metrics: { getMeter: () => meter },
}))

import {
  recordDeepResearchAssessment,
  recordDeepResearchAttemptDuration,
  recordDeepResearchBudgetExhausted,
  recordDeepResearchCancellationLatency,
  recordDeepResearchCheckpointReuse,
  recordDeepResearchExternalCallsAfterCancellation,
  recordDeepResearchIteration,
  recordDeepResearchLeaseRejectedWrite,
  recordDeepResearchNoMaterialGain,
  recordDeepResearchResumeOutcome,
  recordDeepResearchStopReason,
} from './metrics'

const unsafeContext = {
  researchRunId: 'run-contains-private-id',
  workflowRunId: 'workflow-contains-private-id',
  profile: 'private-topic?token=secret',
  depth: 'C:\\Users\\private\\report.md',
  phase: 'https://example.invalid/path?apiKey=secret',
  counts: { sources: 3, 'query=secret': 1, 'C:\Users\private': 1 },
}

function observedAttributes() {
  return [
    ...[...counters.values()].flatMap((instrument) => instrument.add.mock.calls.map(([, attributes]) => attributes)),
    ...[...histograms.values()].flatMap((instrument) => instrument.record.mock.calls.map(([, attributes]) => attributes)),
  ]
}

describe('Deep Research phase 2 telemetry', () => {
  beforeEach(() => {
    for (const instrument of counters.values()) instrument.add.mockClear()
    for (const instrument of histograms.values()) instrument.record.mockClear()
  })

  it('records the Phase 2 lifecycle metrics with allowlisted, payload-free attributes', () => {
    recordDeepResearchAssessment({ verdict: 'limited', score: 0.62 }, unsafeContext)
    recordDeepResearchIteration({ ordinal: 2, evidenceDelta: 3, scoreDelta: 0.12 }, unsafeContext)
    recordDeepResearchStopReason('stop_no_material_gain', unsafeContext)
    recordDeepResearchBudgetExhausted(unsafeContext)
    recordDeepResearchNoMaterialGain(unsafeContext)
    recordDeepResearchCancellationLatency(42, unsafeContext)
    recordDeepResearchExternalCallsAfterCancellation(0, unsafeContext)
    recordDeepResearchResumeOutcome('succeeded', unsafeContext)
    recordDeepResearchCheckpointReuse(unsafeContext)
    recordDeepResearchLeaseRejectedWrite(unsafeContext)
    recordDeepResearchAttemptDuration(120, unsafeContext)

    expect(counters.get('deepresearch.coverage.verdict.count')?.add).toHaveBeenCalledWith(1, expect.objectContaining({ 'research.coverage.verdict': 'limited' }))
    expect(histograms.get('deepresearch.coverage.score')?.record).toHaveBeenCalledWith(0.62, expect.any(Object))
    expect(histograms.get('deepresearch.iteration.ordinal')?.record).toHaveBeenCalledWith(2, expect.any(Object))
    expect(histograms.get('deepresearch.iteration.evidence_delta')?.record).toHaveBeenCalledWith(3, expect.any(Object))
    expect(histograms.get('deepresearch.iteration.coverage_score_delta')?.record).toHaveBeenCalledWith(0.12, expect.any(Object))
    expect(counters.get('deepresearch.stop.reason.count')?.add).toHaveBeenCalledWith(1, expect.objectContaining({ 'research.stop.reason': 'stop_no_material_gain' }))
    expect(counters.get('deepresearch.budget.exhausted.count')?.add).toHaveBeenCalledTimes(1)
    expect(counters.get('deepresearch.iteration.no_material_gain.count')?.add).toHaveBeenCalledTimes(1)
    expect(histograms.get('deepresearch.cancellation.latency.ms')?.record).toHaveBeenCalledWith(42, expect.any(Object))
    expect(counters.get('deepresearch.cancellation.external_calls_after_request.count')?.add).toHaveBeenCalledWith(0, expect.any(Object))
    expect(counters.get('deepresearch.resume.outcome.count')?.add).toHaveBeenCalledWith(1, expect.objectContaining({ 'research.resume.outcome': 'succeeded' }))
    expect(counters.get('deepresearch.checkpoint.reused.count')?.add).toHaveBeenCalledTimes(1)
    expect(counters.get('deepresearch.lease.rejected_write.count')?.add).toHaveBeenCalledTimes(1)
    expect(histograms.get('deepresearch.attempt.duration.ms')?.record).toHaveBeenCalledWith(120, expect.any(Object))

    for (const attributes of observedAttributes()) {
      expect(JSON.stringify(attributes)).not.toContain('private')
      expect(JSON.stringify(attributes)).not.toContain('secret')
      expect(JSON.stringify(attributes)).not.toContain('example.invalid')
      expect(JSON.stringify(attributes)).not.toContain('C:\\Users')
      expect(attributes).not.toHaveProperty('research.run.id')
      expect(attributes).not.toHaveProperty('workflow.run.id')
    }
  })
})
