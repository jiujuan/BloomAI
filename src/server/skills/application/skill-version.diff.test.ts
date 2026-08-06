import { describe, expect, it } from 'vitest'
import { diffSkillVersions } from './skill-version.diff'

describe('skill version diff', () => {
  it('produces deterministic manifest, file, capability, and source changes', () => {
    const from = {
      id: 'v1',
      manifestHash: 'manifest-1',
      manifest: {
        name: 'demo',
        description: 'old',
        requestedCapabilities: [{ capability: 'web.search' }],
        files: [
          { path: 'SKILL.md', sha256: 'a', sizeBytes: 10 },
          { path: 'references/old.md', sha256: 'b', sizeBytes: 20 },
        ],
        prompt: 'do not expose this',
      },
      sourceSnapshot: { sourceSha256: 'source-1' },
    }
    const to = {
      id: 'v2',
      manifestHash: 'manifest-2',
      manifest: {
        name: 'demo',
        description: 'new',
        requestedCapabilities: [{ capability: 'web.search' }, { capability: 'image.generate' }],
        files: [
          { path: 'SKILL.md', sha256: 'changed', sizeBytes: 12 },
          { path: 'assets/new.png', sha256: 'c', sizeBytes: 30 },
        ],
        prompt: 'another secret',
      },
      sourceSnapshot: { sourceSha256: 'source-2' },
    }

    const first = diffSkillVersions(from, to)
    const second = diffSkillVersions(from, to)

    expect(first).toEqual(second)
    expect(first.files).toEqual({
      added: ['assets/new.png'],
      changed: ['SKILL.md'],
      removed: ['references/old.md'],
    })
    expect(first.capabilities).toEqual({ added: ['image.generate'], removed: [] })
    expect(first.sourceShaChanged).toBe(true)
    expect(first.riskSummary).toMatchObject({ level: 'high', warnings: expect.arrayContaining(['capability expansion: image.generate']) })
    expect(JSON.stringify(first)).not.toContain('do not expose this')
    expect(JSON.stringify(first)).not.toContain('another secret')
  })
})
