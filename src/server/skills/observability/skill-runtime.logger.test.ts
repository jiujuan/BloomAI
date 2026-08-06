import { describe, expect, it } from 'vitest'
import {
  SkillRuntimeLogger,
  getSkillCorrelation,
  withSkillCorrelation,
} from './skill-runtime.logger'

describe('Skill Runtime structured logger', () => {
  it('propagates all correlation fields while redacting prompt, raw input, and secrets', async () => {
    const entries: unknown[] = []
    const logger = new SkillRuntimeLogger({ sink: (entry) => entries.push(entry), sampleRate: 1, now: () => 20_000 })

    await withSkillCorrelation({
      requestId: 'req-1', runId: 'run-1', skillVersionId: 'version-1', packageId: 'package-1',
      workerId: 'worker-1', grantId: 'grant-1', artifactId: 'artifact-1',
    }, async () => {
      expect(getSkillCorrelation()).toMatchObject({ requestId: 'req-1', runId: 'run-1', workerId: 'worker-1' })
      logger.info('run.completed', 'Run completed', {
        prompt: 'do not persist this prompt',
        rawInput: { customer: 'private' },
        authorization: 'Bearer top-secret',
        status: 'completed',
      })
    })

    const serialized = JSON.stringify(entries)
    expect(entries).toHaveLength(1)
    expect(serialized).toContain('req-1')
    expect(serialized).toContain('run-1')
    expect(serialized).not.toContain('do not persist')
    expect(serialized).not.toContain('private')
    expect(serialized).not.toContain('top-secret')
    expect((entries[0] as any).correlation).toEqual({
      requestId: 'req-1', runId: 'run-1', skillVersionId: 'version-1', packageId: 'package-1',
      workerId: 'worker-1', grantId: 'grant-1', artifactId: 'artifact-1',
    })
  })

  it('supports sampling and independently retains only recent entries', () => {
    let now = 1_000
    const entries: unknown[] = []
    const logger = new SkillRuntimeLogger({ sink: (entry) => entries.push(entry), sampleRate: 0, retentionMs: 100, now: () => now })

    logger.info('sampled', 'not sampled')
    expect(entries).toHaveLength(0)
    logger.setSampleRate(1)
    logger.info('kept', 'kept')
    now = 1_150
    logger.info('fresh', 'fresh')

    expect(logger.recent()).toHaveLength(1)
    expect(logger.recent()[0]).toMatchObject({ scope: 'fresh', message: 'fresh' })
  })
})
