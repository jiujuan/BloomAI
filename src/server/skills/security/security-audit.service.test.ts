import { describe, expect, it } from 'vitest'
import { auditSecurityDecision } from './security-audit.service'

describe('security audit service contract', () => {
  it('requires a security decision and keeps secret-looking keys redacted', () => {
    const events: any[] = []
    expect(() => auditSecurityDecision({
      audit: { append: (event) => events.push(event) },
      action: 'security.check',
      resourceType: 'skill_security',
      securityDecision: 'deny',
      payload: { password: 'hidden' },
    })).not.toThrow()
    expect(events[0].payload).toEqual({ password: '[REDACTED]' })
    expect(events[0].securityDecision).toBe('deny')
  })
})
