import type {
  WebRoutingPolicy,
  WebSearchFallbackProviderId,
  WebSearchOutput,
  WebSearchProvider,
  WebSearchRequest,
} from './contracts'

export type SearchProviderAttempt = (request: WebSearchRequest) => Promise<WebSearchOutput>

export type SearchProviderRouterOptions = {
  anysearch?: SearchProviderAttempt
  tavily?: SearchProviderAttempt
  duckduckgo: SearchProviderAttempt
  agentBrowser?: WebSearchProvider | (() => WebSearchProvider)
  routingPolicy: WebRoutingPolicy
}

type SearchFailure = {
  provider: WebSearchFallbackProviderId
  message: string
  fallbackFrom?: WebSearchFallbackProviderId
  fallbackReason?: string
}

export class WebSearchSerpBlockedError extends Error {
  readonly code = 'WEB_SEARCH_SERP_BLOCKED' as const

  constructor(message = 'SERP access was blocked or did not expose usable results') {
    super(message)
    this.name = 'WebSearchSerpBlockedError'
  }
}

export class SearchProviderRouter {
  constructor(private readonly options: SearchProviderRouterOptions) {}

  async search(request: WebSearchRequest): Promise<WebSearchOutput> {
    let lastFailure: SearchFailure | undefined
    let lastOutput: WebSearchOutput | undefined

    const providers: Array<{ id: WebSearchFallbackProviderId; attempt: SearchProviderAttempt }> = [
      ...(this.options.anysearch ? [{ id: 'anysearch' as const, attempt: this.options.anysearch }] : []),
      ...(this.options.tavily ? [{ id: 'tavily' as const, attempt: this.options.tavily }] : []),
      { id: 'duckduckgo', attempt: this.options.duckduckgo },
    ]

    for (const provider of providers) {
      try {
        const output = await provider.attempt({
          ...request,
          ...(lastFailure
            ? { fallbackFrom: lastFailure.provider, fallbackReason: lastFailure.message }
            : {}),
        })
        if (output.results.length > 0) {
          return lastFailure
            ? {
                ...output,
                fallbackFrom: output.fallbackFrom ?? lastFailure.provider,
                fallbackReason: output.fallbackReason ?? lastFailure.message,
              }
            : output
        }
        lastOutput = output
        lastFailure = {
          provider: provider.id,
          message: `${providerLabel(provider.id)} returned no usable results`,
          ...(lastFailure
            ? { fallbackFrom: lastFailure.provider, fallbackReason: lastFailure.message }
            : {}),
        }
      } catch (error) {
        if (request.signal?.aborted) throw error
        lastFailure = {
          provider: provider.id,
          message: errorMessage(error),
          ...(lastFailure
            ? { fallbackFrom: lastFailure.provider, fallbackReason: lastFailure.message }
            : {}),
        }
      }
    }

    const fallbackOutput = buildFallbackOutput(request, lastOutput, lastFailure)
    if (
      !this.options.routingPolicy.browserEnabled
      || !this.options.routingPolicy.allowSearchFallback
      || !this.options.agentBrowser
    ) return fallbackOutput

    const agentBrowser = typeof this.options.agentBrowser === 'function'
      ? this.options.agentBrowser()
      : this.options.agentBrowser
    const browserLimit = Math.min(
      Math.max(1, Math.floor(request.limit)),
      this.options.routingPolicy.maxSearchResults ?? 5,
      5,
    )
    const release = await browserSearchGate.acquire(request.signal)
    try {
      const output = await agentBrowser.search({
        ...request,
        limit: browserLimit,
        fallbackFrom: lastFailure?.provider,
        fallbackReason: lastFailure?.message,
      })
      return {
        ...output,
        query: output.query || request.query,
        total: output.results.length,
        results: output.results.slice(0, browserLimit),
        fallbackFrom: lastFailure?.provider,
        fallbackReason: lastFailure?.message,
      }
    } catch (error) {
      if (request.signal?.aborted) throw error
      if (isSerpBlocked(error)) {
        return {
          query: request.query,
          total: 0,
          results: [],
          provider: 'agent_browser_serp',
          fallbackFrom: lastFailure?.provider,
          fallbackReason: lastFailure?.message,
          errorCode: 'WEB_SEARCH_SERP_BLOCKED',
          error: errorMessage(error),
        }
      }
      return {
        ...fallbackOutput,
        fallbackReason: `${fallbackOutput.fallbackReason ?? ''}${fallbackOutput.fallbackReason ? '; ' : ''}SERP fallback failed`,
      }
    } finally {
      release()
    }
  }
}

export function createSearchProviderRouter(options: SearchProviderRouterOptions): SearchProviderRouter {
  return new SearchProviderRouter(options)
}

export function getActiveBrowserSearches(): number {
  return browserSearchGate.activeCount
}

function buildFallbackOutput(
  request: WebSearchRequest,
  output: WebSearchOutput | undefined,
  failure: SearchFailure | undefined,
): WebSearchOutput {
  return {
    ...(output ?? {}),
    query: request.query,
    total: output?.results.length ?? 0,
    results: output?.results ?? [],
    provider: failure?.provider ?? output?.provider ?? 'duckduckgo',
    ...(failure ? { error: output?.error ?? failure.message } : {}),
    ...(failure?.fallbackFrom
      ? { fallbackFrom: failure.fallbackFrom, fallbackReason: failure.fallbackReason }
      : failure?.provider === 'tavily'
        ? { fallbackFrom: 'tavily', fallbackReason: failure.message }
        : output?.fallbackFrom
          ? { fallbackFrom: output.fallbackFrom, fallbackReason: output.fallbackReason }
          : {}),
  }
}

function providerLabel(provider: WebSearchFallbackProviderId): string {
  if (provider === 'anysearch') return 'AnySearch'
  if (provider === 'tavily') return 'Tavily'
  return 'DuckDuckGo'
}

function isSerpBlocked(error: unknown): error is WebSearchSerpBlockedError {
  return error instanceof WebSearchSerpBlockedError
    || (isRecord(error) && error.code === 'WEB_SEARCH_SERP_BLOCKED')
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown web search error'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

type SemaphoreWaiter = {
  resolve: () => void
  reject: (reason: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

class AbortableSemaphore {
  private active = 0
  private readonly waiters: SemaphoreWaiter[] = []

  constructor(private readonly limit: number) {}

  get activeCount(): number {
    return this.active
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Search browser fallback cancelled'))
    if (this.active < this.limit) {
      this.active += 1
      return Promise.resolve(() => this.release())
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: SemaphoreWaiter = {
        resolve: () => {
          this.active += 1
          resolve(() => this.release())
        },
        reject,
        signal,
      }
      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        signal?.removeEventListener('abort', waiter.onAbort!)
        reject(signal?.reason ?? new Error('Search browser fallback cancelled'))
      }
      signal?.addEventListener('abort', waiter.onAbort, { once: true })
      this.waiters.push(waiter)
    })
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1)
    const waiter = this.waiters.shift()
    if (!waiter) return
    waiter.signal?.removeEventListener('abort', waiter.onAbort!)
    if (waiter.signal?.aborted) {
      waiter.reject(waiter.signal.reason ?? new Error('Search browser fallback cancelled'))
      this.release()
      return
    }
    waiter.resolve()
  }
}

const browserSearchGate = new AbortableSemaphore(1)
