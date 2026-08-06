import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadSkillRuntimeConfig } from '../config/skill-runtime.config'
import { createFakeSkillRuntimePorts } from '../application/test-doubles'
import { SkillRuntimeMetrics } from '../observability/skill-runtime.metrics'
import { createSkillRuntime } from './skill-runtime.composition-root'

function config(overrides: Record<string, string> = {}) {
  const base = path.join(os.tmpdir(), `bloomai-runtime-${Math.random().toString(16).slice(2)}`)
  return loadSkillRuntimeConfig({
    SKILL_PACKAGE_DATA_ROOT: path.join(base, 'packages'),
    SKILL_ARTIFACT_ROOT: path.join(base, 'artifacts'),
    SKILL_EXPORT_ROOT: path.join(base, 'exports'),
    ...overrides,
  }, { existsSync: () => false })
}

describe('createSkillRuntime', () => {
  it('keeps the worker disabled unless package execution is explicitly enabled', async () => {
    const runtime = createSkillRuntime({ config: config(), ports: createFakeSkillRuntimePorts() })
    expect(runtime.start()).toEqual({ started: false, reason: 'packageExecutionEnabled' })
    await runtime.stop()
  })

  it('shares one metrics instance across the assembled queue, coordinator, and worker', async () => {
    const ports = createFakeSkillRuntimePorts()
    const metrics = new SkillRuntimeMetrics({ now: ports.clock.now })
    const runtime = createSkillRuntime({
      config: config({ SKILL_PACKAGE_EXECUTION_ENABLED: 'true', SKILL_WORKER_CONCURRENCY: '1' }),
      ports,
      metrics,
      executor: async () => ({ status: 'completed', output: { observed: true } }),
    })
    const { runId } = runtime.coordinator.startRun({ skillVersionId: 'version-metrics', input: {}, context: {} })

    expect(runtime.metrics).toBe(metrics)
    expect(runtime.start()).toEqual({ started: true })
    await runtime.worker?.runOne()
    await runtime.stop({ drain: false })

    expect(runtime.coordinator.getRun(runId)).toMatchObject({ status: 'completed' })
    expect(metrics.snapshot().counters.runsByStatus.completed).toBe(1)
    expect(metrics.snapshot().points.some((point) => point.kind === 'queue')).toBe(true)
  })

  it('builds diagnostics from the composed runtime instead of empty defaults', async () => {
    const ports = createFakeSkillRuntimePorts({ now: 10_000 })
    const metrics = new SkillRuntimeMetrics({ now: ports.clock.now })
    const runtime = createSkillRuntime({
      config: config({ SKILL_PACKAGE_EXECUTION_ENABLED: 'true', SKILL_MAX_ATTEMPTS: '1' }),
      ports,
      metrics,
      executor: async () => { throw new Error('secret token=should-not-leak') },
    })
    const { runId } = runtime.coordinator.startRun({ skillVersionId: 'version-diagnostics', input: {}, context: {} })

    await runtime.worker?.runOne()
    await runtime.stop({ drain: false })
    const diagnostics = runtime.getRuntimeDiagnostics({
      migrations: { current: '043-skill-security-audit-fields', applied: ['043-skill-security-audit-fields'], pending: [] },
    })

    expect(diagnostics.queue).toMatchObject({ depth: 1, dead: 1 })
    expect(diagnostics.worker).toMatchObject({ status: 'stopped' })
    expect(diagnostics.migration).toMatchObject({ current: '043-skill-security-audit-fields', pending: [] })
    expect(diagnostics.recentFailures).toEqual(expect.arrayContaining([expect.objectContaining({ runId })]))
    expect(JSON.stringify(diagnostics)).not.toContain('should-not-leak')
  })

  it('assembles coordinator, queue, and worker with one injected port set', async () => {
    const ports = createFakeSkillRuntimePorts()
    const runtime = createSkillRuntime({
      config: config({ SKILL_PACKAGE_EXECUTION_ENABLED: 'true', SKILL_WORKER_CONCURRENCY: '1' }),
      ports,
      executor: async () => ({ status: 'completed', output: { assembled: true } }),
    })
    const { runId } = runtime.coordinator.startRun({ skillVersionId: 'version-1', input: {}, context: {} })

    expect(runtime.start()).toEqual({ started: true })
    await runtime.worker?.runOne()
    await runtime.stop({ drain: false })
    expect(runtime.coordinator.getRun(runId)).toMatchObject({ status: 'completed', output: { assembled: true } })
    expect(runtime.queue.list({ runId })).toMatchObject([{ status: 'done' }])
  })
})
