import { describe, expect, it } from 'vitest'
import {
  calculateCapabilityDiff,
  capabilityGrantRequestSchema,
  isScopeAllowed,
  selectInheritableGrants,
} from './capability-policy'

describe('capability policy', () => {
  it('accepts the B-Lite capability vocabulary and only valid grant modes', () => {
    expect(capabilityGrantRequestSchema.parse({
      capability: 'image.generate',
      grantMode: 'session',
      scope: { allowedModels: ['agnes-image-2.1-flash'], maxCalls: 6 },
      sessionId: 'session-1',
    })).toMatchObject({ capability: 'image.generate', grantMode: 'session' })

    expect(() => capabilityGrantRequestSchema.parse({
      capability: 'shell.execute',
      grantMode: 'persistent',
    })).toThrow()
    expect(() => capabilityGrantRequestSchema.parse({
      capability: 'web.fetch',
      grantMode: 'forever',
    })).toThrow()
  })

  it('enforces domain and uploaded-file root scopes', () => {
    expect(isScopeAllowed({
      capability: 'web.fetch',
      input: { url: 'https://docs.example.test/guide' },
      scope: { allowedDomains: ['docs.example.test'] },
    })).toEqual({ allowed: true })
    expect(isScopeAllowed({
      capability: 'web.fetch',
      input: { url: 'https://api.example.test/v1' },
      scope: { allowedDomains: ['docs.example.test'] },
    })).toMatchObject({ allowed: false })

    expect(isScopeAllowed({
      capability: 'document.read_uploaded',
      input: { path: '/uploads/article.md' },
      scope: { allowedRoots: ['/uploads'] },
    })).toEqual({ allowed: true })
    expect(isScopeAllowed({
      capability: 'document.read_uploaded',
      input: { path: '/uploads/../secrets.env' },
      scope: { allowedRoots: ['/uploads'] },
    })).toMatchObject({ allowed: false })
  })

  it('flags new and broadened requested permissions during an upgrade', () => {
    const previous = [
      { capability: 'web.fetch', scope: { allowedDomains: ['docs.example.test'] } },
      { capability: 'image.generate', scope: { allowedModels: ['agnes-image-2.1-flash'], maxCalls: 6 } },
    ] as const
    const next = [
      { capability: 'web.fetch', scope: { allowedDomains: ['docs.example.test', 'api.example.test'] } },
      { capability: 'image.generate', scope: { allowedModels: ['agnes-image-2.1-flash'], maxCalls: 4 } },
      { capability: 'artifact.write', scope: {} },
    ] as const

    expect(calculateCapabilityDiff(previous, next)).toEqual({
      added: ['artifact.write'],
      removed: [],
      broadened: ['web.fetch'],
      narrowed: ['image.generate'],
      unchanged: [],
    })
  })

  it('only selects grants that remain valid for a version with equal or narrower needs', () => {
    const grants = [
      {
        id: 'web-grant', capability: 'web.fetch', grant_mode: 'persistent',
        scope_json: JSON.stringify({ allowedDomains: ['docs.example.test'] }),
        granted_by: 'user-1', granted_at: 1, expires_at: null, revoked_at: null, session_id: null, consumed_at: null,
      },
      {
        id: 'image-grant', capability: 'image.generate', grant_mode: 'persistent',
        scope_json: JSON.stringify({ allowedModels: ['agnes-image-2.1-flash'], maxCalls: 6 }),
        granted_by: 'user-1', granted_at: 1, expires_at: null, revoked_at: null, session_id: null, consumed_at: null,
      },
    ]

    const inheritable = selectInheritableGrants(grants, [
      { capability: 'web.fetch', scope: { allowedDomains: ['docs.example.test', 'api.example.test'] } },
      { capability: 'image.generate', scope: { allowedModels: ['agnes-image-2.1-flash'], maxCalls: 4 } },
    ])

    expect(inheritable.map((grant) => grant.id)).toEqual(['image-grant'])
  })

  it('does not treat an unbounded next image budget as narrower than a bounded grant', () => {
    const grants = [{
      id: 'image-grant', capability: 'image.generate', grant_mode: 'persistent',
      scope_json: JSON.stringify({ allowedModels: ['agnes-image-2.1-flash'], maxCalls: 6 }),
      granted_by: 'user-1', granted_at: 1, expires_at: null, revoked_at: null, session_id: null, consumed_at: null,
    }]

    expect(selectInheritableGrants(grants, [
      { capability: 'image.generate', scope: { allowedModels: ['agnes-image-2.1-flash'] } },
    ])).toEqual([])
  })

  it('does not inherit a malformed persisted grant scope', () => {
    expect(selectInheritableGrants([{
      id: 'bad-grant', capability: 'web.fetch', grant_mode: 'persistent', scope_json: '{not json',
      granted_by: 'user-1', granted_at: 1, expires_at: null, revoked_at: null, session_id: null, consumed_at: null,
    }], [{ capability: 'web.fetch', scope: {} }])).toEqual([])
  })
})
