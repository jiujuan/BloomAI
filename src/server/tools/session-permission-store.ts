export type SessionPermission = {
  toolId: string
  sessionId: string
  grantedAt: number
  expiresAt: number
}

export type SessionPermissionStoreOptions = {
  now?: () => number
}

const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1_000

export class SessionToolPermissionStore {
  private readonly grants = new Map<string, SessionPermission>()
  private readonly now: () => number

  constructor(options: SessionPermissionStoreOptions = {}) {
    this.now = options.now ?? Date.now
  }

  grant(toolId: string, sessionId: string, ttlMs = DEFAULT_SESSION_TTL_MS): SessionPermission {
    assertSessionId(sessionId)
    if (!toolId.trim()) throw new Error('Tool id is required')
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Session permission ttl must be positive')

    const permission = {
      toolId,
      sessionId,
      grantedAt: this.now(),
      expiresAt: this.now() + ttlMs,
    }
    this.grants.set(this.key(toolId, sessionId), permission)
    return permission
  }

  has(toolId: string, sessionId: string | undefined): boolean {
    if (!sessionId?.trim()) return false
    const key = this.key(toolId, sessionId)
    const permission = this.grants.get(key)
    if (!permission) return false
    if (permission.expiresAt <= this.now()) {
      this.grants.delete(key)
      return false
    }
    return true
  }

  revoke(toolId: string, sessionId: string): void {
    if (!sessionId.trim()) return
    this.grants.delete(this.key(toolId, sessionId))
  }

  clearSession(sessionId: string): void {
    if (!sessionId.trim()) return
    for (const [key, permission] of this.grants) {
      if (permission.sessionId === sessionId) this.grants.delete(key)
    }
  }

  clear(): void {
    this.grants.clear()
  }

  private key(toolId: string, sessionId: string): string {
    return `${toolId}\u0000${sessionId}`
  }
}

export const sessionToolPermissionStore = new SessionToolPermissionStore()

function assertSessionId(sessionId: string): void {
  if (!sessionId.trim()) throw new Error('Session id is required for a session permission')
}
