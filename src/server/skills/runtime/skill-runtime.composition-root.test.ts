import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadSkillRuntimeConfig } from '../config/skill-runtime.config'
import { createFakeSkillRuntimePorts } from '../application/test-doubles'
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
