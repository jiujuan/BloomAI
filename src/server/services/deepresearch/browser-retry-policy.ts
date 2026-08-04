import type { SourceContentDiagnostics, SourceContentRejectionReason } from '@server/deepresearch/domain/source-content'

export type BrowserRetryReason = Extract<SourceContentRejectionReason, 'needs_rendering' | 'too_short' | 'navigation_heavy'>

export type BrowserRetryDecision = {
  retry: boolean
  reason: BrowserRetryReason | null
}

const RETRYABLE_REASONS: readonly BrowserRetryReason[] = ['needs_rendering', 'too_short', 'navigation_heavy']

export function shouldRetryWithBrowser(diagnostics: Partial<SourceContentDiagnostics> | null | undefined): BrowserRetryDecision {
  const reasons = Array.isArray(diagnostics?.rejectionReasons)
    ? diagnostics.rejectionReasons
    : []
  const reason = RETRYABLE_REASONS.find((candidate) => reasons.includes(candidate)) ?? null
  return { retry: reason !== null, reason }
}

export type BrowserRetryReservation = {
  sourceId: string
  reason: BrowserRetryReason
}

export type BrowserRetryBudget = {
  maxBrowserFetches: number
  browserFetchConcurrency: number
  used: number
  active: number
  reservedSources: number
  tryReserve(sourceId: string, reason: BrowserRetryReason): BrowserRetryReservation | null
  run<T>(reservation: BrowserRetryReservation, signal: AbortSignal | undefined, deadlineAt: number | null, operation: () => Promise<T>): Promise<T>
}

type Waiter = {
  resolve: () => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

export function createBrowserRetryBudget(options: {
  maxBrowserFetches?: number
  browserFetchConcurrency?: number
}): BrowserRetryBudget {
  const maxBrowserFetches = Math.max(0, Math.floor(options.maxBrowserFetches ?? 0))
  const browserFetchConcurrency = Math.max(1, Math.floor(options.browserFetchConcurrency ?? 1))
  const reservedSourceIds = new Set<string>()
  const waiters: Waiter[] = []
  let used = 0
  let active = 0

  const pump = () => {
    while (active < browserFetchConcurrency && waiters.length > 0) {
      const waiter = waiters.shift()!
      waiter.signal?.removeEventListener('abort', waiter.onAbort!)
      active += 1
      waiter.resolve()
    }
  }

  const acquire = (signal?: AbortSignal, deadlineAt: number | null = null): Promise<void> => {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Browser retry was cancelled.'))
    if (deadlineAt !== null && Date.now() >= deadlineAt) return Promise.reject(new Error('Browser retry deadline exhausted.'))
    if (active < browserFetchConcurrency) {
      active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal }
      const onAbort = () => {
        const index = waiters.indexOf(waiter)
        if (index >= 0) waiters.splice(index, 1)
        signal?.removeEventListener('abort', onAbort)
        reject(signal?.reason ?? new Error('Browser retry was cancelled.'))
      }
      waiter.onAbort = onAbort
      signal?.addEventListener('abort', onAbort, { once: true })
      waiters.push(waiter)
      pump()
    })
  }

  const release = () => {
    active = Math.max(0, active - 1)
    pump()
  }

  return {
    maxBrowserFetches,
    browserFetchConcurrency,
    get used() { return used },
    get active() { return active },
    get reservedSources() { return reservedSourceIds.size },
    tryReserve(sourceId, reason) {
      if (used >= maxBrowserFetches || reservedSourceIds.has(sourceId)) return null
      reservedSourceIds.add(sourceId)
      used += 1
      return { sourceId, reason }
    },
    async run(reservation, signal, deadlineAt, operation) {
      if (!reservedSourceIds.has(reservation.sourceId)) throw new Error('Browser retry reservation is not active.')
      let acquired = false
      let started = false
      try {
        await acquire(signal, deadlineAt)
        acquired = true
        if (signal?.aborted) throw signal.reason ?? new Error('Browser retry was cancelled.')
        if (deadlineAt !== null && Date.now() >= deadlineAt) throw new Error('Browser retry deadline exhausted.')
        started = true
        return await operation()
      } finally {
        if (acquired) release()
        if (!started) {
          reservedSourceIds.delete(reservation.sourceId)
          used = Math.max(0, used - 1)
        }
      }
    },
  }
}
