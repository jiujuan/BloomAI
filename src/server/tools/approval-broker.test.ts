import { describe, expect, it } from 'vitest'
import { ApprovalBroker } from './approval-broker'
import { createApprovalToken } from './approval-token'

const secret = 'a1-test-secret'

describe('ApprovalBroker', () => {
  it('consumes a valid token once when tool, session, and input match', () => {
    const broker = new ApprovalBroker({ secret, now: () => 1_000 })
    const token = createApprovalToken({
      secret,
      now: 1_000,
      toolId: 'fs_write',
      sessionId: 'session-a',
      input: { path: 'notes.txt', content: 'hello' },
    })

    expect(broker.consume(token, {
      toolId: 'fs_write',
      sessionId: 'session-a',
      input: { path: 'notes.txt', content: 'hello' },
    })).toEqual({ approved: true, approvalId: expect.any(String) })

    expect(() => broker.consume(token, {
      toolId: 'fs_write',
      sessionId: 'session-a',
      input: { path: 'notes.txt', content: 'hello' },
    })).toThrow(/already|consumed/i)
  })

  it('rejects expired, mismatched, and modified-input tokens', () => {
    const broker = new ApprovalBroker({ secret, now: () => 10_001 })
    const token = createApprovalToken({
      secret,
      now: 1_000,
      ttlMs: 5_000,
      toolId: 'fs_write',
      sessionId: 'session-a',
      input: { path: 'notes.txt', content: 'hello' },
    })

    expect(() => broker.consume(token, {
      toolId: 'fs_write',
      sessionId: 'session-a',
      input: { path: 'notes.txt', content: 'hello' },
    })).toThrow(/expired/i)

    const freshBroker = new ApprovalBroker({ secret, now: () => 1_001 })
    const freshToken = createApprovalToken({
      secret,
      now: 1_000,
      toolId: 'fs_write',
      sessionId: 'session-a',
      input: { path: 'notes.txt', content: 'hello' },
    })

    expect(() => freshBroker.consume(freshToken, {
      toolId: 'fs_read',
      sessionId: 'session-a',
      input: { path: 'notes.txt', content: 'hello' },
    })).toThrow(/tool/i)

    expect(() => freshBroker.consume(freshToken, {
      toolId: 'fs_write',
      sessionId: 'session-b',
      input: { path: 'notes.txt', content: 'hello' },
    })).toThrow(/session/i)

    expect(() => freshBroker.consume(freshToken, {
      toolId: 'fs_write',
      sessionId: 'session-a',
      input: { path: 'notes.txt', content: 'hellO' },
    })).toThrow(/input/i)
  })

  it('rejects a token signed with a different secret', () => {
    const broker = new ApprovalBroker({ secret, now: () => 1_001 })
    const token = createApprovalToken({
      secret: 'other-secret',
      now: 1_000,
      toolId: 'fs_write',
      sessionId: 'session-a',
      input: {},
    })

    expect(() => broker.consume(token, {
      toolId: 'fs_write',
      sessionId: 'session-a',
      input: {},
    })).toThrow(/signature|token/i)
  })
})
