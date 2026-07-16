import { describe, expect, it } from 'vitest'
import { shouldQueueMessageUntilSessionIsActive } from './ChatPanelMastra'

describe('initial chat session activation', () => {
  it('queues the first message until the created session becomes active', () => {
    expect(shouldQueueMessageUntilSessionIsActive(null, 'session-1')).toBe(true)
    expect(shouldQueueMessageUntilSessionIsActive('session-1', 'session-1')).toBe(false)
  })
})
