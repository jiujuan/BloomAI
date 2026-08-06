import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXPECTED_SKILL_FIXTURES, fixturePath, readFixtureManifest } from '../../fixtures/skills/fixture-utils'

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
})
