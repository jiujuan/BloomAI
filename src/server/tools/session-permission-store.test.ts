import { describe, expect, it } from 'vitest'
import { SessionToolPermissionStore } from './session-permission-store'

describe('SessionToolPermissionStore', () => {
  it('binds a grant to both tool and session', () => {
    const store = new SessionToolPermissionStore({ now: () => 1_000 })

    store.grant('fs_write', 'session-a', 5_000)

    expect(store.has('fs_write', 'session-a')).toBe(true)
    expect(store.has('fs_write', 'session-b')).toBe(false)
  })

  it('expires grants and supports revocation', () => {
    let now = 1_000
    const store = new SessionToolPermissionStore({ now: () => now })

    store.grant('fs_write', 'session-a', 100)
    expect(store.has('fs_write', 'session-a')).toBe(true)

    now = 1_101
    expect(store.has('fs_write', 'session-a')).toBe(false)

    store.grant('fs_write', 'session-a', 5_000)
    store.revoke('fs_write', 'session-a')
    expect(store.has('fs_write', 'session-a')).toBe(false)
  })

  it('does not carry grants into a new store instance', () => {
    const first = new SessionToolPermissionStore({ now: () => 1_000 })
    first.grant('fs_write', 'session-a', 5_000)

    const restarted = new SessionToolPermissionStore({ now: () => 1_000 })

    expect(restarted.has('fs_write', 'session-a')).toBe(false)
  })

  it('requires a non-empty session id', () => {
    const store = new SessionToolPermissionStore()

    expect(() => store.grant('fs_write', '', 1_000)).toThrow(/session/i)
    expect(store.has('fs_write', '')).toBe(false)
  })
})
