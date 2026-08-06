import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { advanceClock, createTestClock, EXPECTED_SKILL_FIXTURES, fakeGitHubArchive, fixturePath, readFixtureManifest } from '../../fixtures/skills/fixture-utils'

describe('offline skill fixtures', () => {
  it('ships the ten deterministic package fixtures required by the release matrix', () => {
    expect(EXPECTED_SKILL_FIXTURES).toEqual([
      'minimal-valid-skill',
      'references-and-assets',
      'capability-approval-skill',
      'unsupported-capability-skill',
      'malicious-path-package',
      'npx-artifact-package',
      'github-archive-package',
      'invalid-manifest-package',
      'failing-runtime-skill',
      'image-skill',
    ])

    for (const name of EXPECTED_SKILL_FIXTURES) {
      expect(fs.existsSync(fixturePath(name, 'SKILL.md')), name).toBe(true)
      expect(readFixtureManifest(name).length, name).toBeGreaterThan(0)
    }
  })

  it('provides a mutable deterministic clock and GitHub archive mock', async () => {
    const { clock, advanceClock: advance } = createTestClock(1_000)
    expect(clock.now()).toBe(1_000)
    expect(advance(250)).toBe(1_250)
    expect(advanceClock(clock, 750)).toBe(2_000)
    expect(clock.now()).toBe(2_000)

    const archive = fakeGitHubArchive()
    const commit = await archive.fetchImpl('https://api.github.com/repos/owner/repo/commits/main')
    expect(commit.status).toBe(200)
    expect((await commit.json()).sha).toHaveLength(40)
    const zipball = await archive.fetchImpl('https://api.github.com/repos/owner/repo/zipball/main')
    expect(zipball.status).toBe(200)
    expect(Buffer.from(await zipball.arrayBuffer())).toEqual(archive.archive)
  })
})
