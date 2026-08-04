type ClosableContext = {
  close(): Promise<unknown> | unknown
}

type ContextFactory<T extends ClosableContext> = () => Promise<T>

type Waiter<T extends ClosableContext> = {
  signal?: AbortSignal
  resolve: (value: BrowserSession<T>) => void
  reject: (reason: unknown) => void
  onAbort?: () => void
  timeout?: ReturnType<typeof setTimeout>
}

export type BrowserSessionPoolOptions = {
  maxConcurrency?: number
  queueTimeoutMs?: number
  idleTimeoutMs?: number
  onIdle?: () => void | Promise<void>
}

export type BrowserSession<T extends ClosableContext> = {
  context: T
  release: () => Promise<void>
}

export class BrowserSessionPool<T extends ClosableContext> {
  private active = 0
  private readonly waiters: Waiter<T>[] = []
  private readonly activeContexts = new Set<T>()
  private readonly closedContexts = new Set<T>()
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  constructor(
    private readonly createContext: ContextFactory<T>,
    maxConcurrencyOrOptions: number | BrowserSessionPoolOptions = 2,
  ) {
    const options = typeof maxConcurrencyOrOptions === 'number'
      ? { maxConcurrency: maxConcurrencyOrOptions }
      : maxConcurrencyOrOptions
    this.maxConcurrency = options.maxConcurrency ?? 2
    this.queueTimeoutMs = options.queueTimeoutMs ?? 5_000
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30_000
    this.onIdle = options.onIdle
    if (!Number.isInteger(this.maxConcurrency) || this.maxConcurrency < 1) {
      throw new Error('Browser session pool concurrency must be a positive integer')
    }
    if (!Number.isInteger(this.queueTimeoutMs) || this.queueTimeoutMs < 0) {
      throw new Error('Browser session pool queue timeout must be a non-negative integer')
    }
    if (!Number.isInteger(this.idleTimeoutMs) || this.idleTimeoutMs < 0) {
      throw new Error('Browser session pool idle timeout must be a non-negative integer')
    }
  }

  private readonly maxConcurrency: number
  private readonly queueTimeoutMs: number
  private readonly idleTimeoutMs: number
  private readonly onIdle?: () => void | Promise<void>
  private peakActive = 0

  async acquire(signal?: AbortSignal): Promise<BrowserSession<T>> {
    if (this.closed) throw new Error('WEB_BROWSER_SHUTDOWN: browser session pool is closed')
    if (signal?.aborted) throw signal.reason ?? new Error('Browser session acquisition cancelled')
    this.clearIdleTimer()
    if (this.active < this.maxConcurrency) return this.createSession(signal)

    return new Promise<BrowserSession<T>>((resolve, reject) => {
      const waiter: Waiter<T> = { signal, resolve, reject }
      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        this.clearWaiter(waiter)
        reject(signal?.reason ?? new Error('Browser session acquisition cancelled'))
      }
      signal?.addEventListener('abort', waiter.onAbort, { once: true })
      this.waiters.push(waiter)
      if (this.queueTimeoutMs > 0) {
        waiter.timeout = setTimeout(() => {
          const index = this.waiters.indexOf(waiter)
          if (index >= 0) this.waiters.splice(index, 1)
          this.clearWaiter(waiter)
          reject(new Error('WEB_BROWSER_QUEUE_TIMEOUT: browser session queue timed out'))
        }, this.queueTimeoutMs)
      }
    })
  }

  private async createSession(signal?: AbortSignal): Promise<BrowserSession<T>> {
    if (this.closed) throw new Error('WEB_BROWSER_SHUTDOWN: browser session pool is closed')
    if (signal?.aborted) throw signal.reason ?? new Error('Browser session acquisition cancelled')
    this.active += 1
    this.peakActive = Math.max(this.peakActive, this.active)
    try {
      const context = await this.createContext()
      if (this.closed) {
        await Promise.resolve(context.close()).catch(() => {})
        throw new Error('WEB_BROWSER_SHUTDOWN: browser session pool is closed')
      }
      this.activeContexts.add(context)
      let released = false
      return {
        context,
        release: async () => {
          if (released) return
          released = true
          this.activeContexts.delete(context)
          if (!this.closedContexts.delete(context)) {
            await Promise.resolve(context.close()).catch(() => {})
          }
          this.active -= 1
          this.dispatchNext()
          this.scheduleIdleClose()
        },
      }
    } catch (error) {
      this.active -= 1
      this.dispatchNext()
      this.scheduleIdleClose()
      throw error
    }
  }

  private dispatchNext(): void {
    if (this.closed) return
    while (this.active < this.maxConcurrency && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!
      this.clearWaiter(waiter)
      if (waiter.signal?.aborted) {
        waiter.reject(waiter.signal.reason ?? new Error('Browser session acquisition cancelled'))
        continue
      }
      void this.createSession(waiter.signal).then(waiter.resolve, waiter.reject)
      break
    }
  }

  private clearWaiter(waiter: Waiter<T>): void {
    waiter.signal?.removeEventListener('abort', waiter.onAbort!)
    if (waiter.timeout) clearTimeout(waiter.timeout)
    waiter.timeout = undefined
  }

  private scheduleIdleClose(): void {
    if (this.closed || this.active !== 0 || this.waiters.length !== 0 || !this.onIdle || this.idleTimeoutMs === 0) return
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined
      void Promise.resolve(this.onIdle?.()).catch(() => {})
    }, this.idleTimeoutMs)
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }

  get activeCount(): number {
    return this.active
  }

  get peakActiveCount(): number {
    return this.peakActive
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.clearIdleTimer()
    const waiters = this.waiters.splice(0)
    for (const waiter of waiters) {
      this.clearWaiter(waiter)
      waiter.reject(new Error('WEB_BROWSER_SHUTDOWN: browser session pool is closed'))
    }
    const contexts = [...this.activeContexts]
    await Promise.all(contexts.map(async (context) => {
      this.closedContexts.add(context)
      await Promise.resolve(context.close()).catch(() => {})
    }))
  }
}
