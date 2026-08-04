import { describe, expect, it } from 'vitest'
import { createBrowserRetryBudget, shouldRetryWithBrowser } from './browser-retry-policy'

describe('browser retry policy', () => {
  it('only retries explicit rendering-related rejection reasons', () => {
    expect(shouldRetryWithBrowser({ rejectionReasons: ['too_short'] })).toEqual({ retry: true, reason: 'too_short' })
    expect(shouldRetryWithBrowser({ rejectionReasons: ['navigation_heavy'] })).toEqual({ retry: true, reason: 'navigation_heavy' })
    expect(shouldRetryWithBrowser({ rejectionReasons: ['captcha'] })).toEqual({ retry: false, reason: null })
    expect(shouldRetryWithBrowser({ rejectionReasons: [] })).toEqual({ retry: false, reason: null })
  })

  it('enforces one reservation per source and a shared maximum', () => {
    const budget = createBrowserRetryBudget({ maxBrowserFetches: 1, browserFetchConcurrency: 1 })
    const first = budget.tryReserve('source-1', 'too_short')

    expect(first).not.toBeNull()
    expect(budget.tryReserve('source-1', 'too_short')).toBeNull()
    expect(budget.tryReserve('source-2', 'needs_rendering')).toBeNull()
    expect(budget.used).toBe(1)
  })

  it('releases queued reservations when cancelled or expired before the operation starts', async () => {
    const budget = createBrowserRetryBudget({ maxBrowserFetches: 2, browserFetchConcurrency: 1 })
    const first = budget.tryReserve('source-1', 'too_short')!
    const second = budget.tryReserve('source-2', 'too_short')!
    let releaseFirst!: () => void
    const firstRun = budget.run(first, undefined, null, () => new Promise<void>((resolve) => { releaseFirst = resolve }))

    const controller = new AbortController()
    const secondRun = budget.run(second, controller.signal, null, async () => undefined)
    controller.abort(new Error('cancelled'))
    await expect(secondRun).rejects.toThrow('cancelled')
    expect(budget.used).toBe(1)
    expect(budget.reservedSources).toBe(1)

    releaseFirst()
    await firstRun
    const expired = budget.tryReserve('source-3', 'too_short')!
    await expect(budget.run(expired, undefined, Date.now() - 1, async () => undefined)).rejects.toThrow('deadline')
    expect(budget.used).toBe(1)
    expect(budget.reservedSources).toBe(1)
  })

  it('keeps browser operations within the configured concurrency', async () => {
    const budget = createBrowserRetryBudget({ maxBrowserFetches: 2, browserFetchConcurrency: 1 })
    const first = budget.tryReserve('source-1', 'too_short')!
    const second = budget.tryReserve('source-2', 'too_short')!
    let active = 0
    let peak = 0
    const operation = async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
    }

    await Promise.all([
      budget.run(first, undefined, null, operation),
      budget.run(second, undefined, null, operation),
    ])

    expect(peak).toBe(1)
  })
})
