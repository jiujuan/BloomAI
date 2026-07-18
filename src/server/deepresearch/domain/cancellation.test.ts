import { describe, expect, it, vi } from 'vitest'
import { ResearchCancellationError, cancellationGuard, isCancellationRequested, throwIfCancellationRequested } from './cancellation'

describe('Deep Research cancellation protocol', () => {
  it('treats either an AbortSignal or durable cancellation observation as cancelled', () => {
    const controller = new AbortController()
    expect(isCancellationRequested({ signal: controller.signal })).toBe(false)
    controller.abort()
    expect(isCancellationRequested({ signal: controller.signal })).toBe(true)
    expect(isCancellationRequested({ isCancellationRequested: () => true })).toBe(true)
  })

  it('raises a typed non-failure cancellation at a safe boundary', () => {
    const requested = vi.fn(() => true)
    expect(() => throwIfCancellationRequested({ isCancellationRequested: requested })).toThrow(ResearchCancellationError)
    expect(cancellationGuard({ isCancellationRequested: requested })).toThrow(ResearchCancellationError)
  })
})
