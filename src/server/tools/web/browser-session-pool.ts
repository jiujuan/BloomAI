type ClosableContext = {
  close(): Promise<unknown> | unknown
}

type ContextFactory<T extends ClosableContext> = () => Promise<T>

type Waiter<T extends ClosableContext> = {
  signal?: AbortSignal
  resolve: (value: BrowserSession<T>) => void
  reject: (reason: unknown) => void
  onAbort?: () => void
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
  private closed = false

  constructor(
    private readonly createContext: ContextFactory<T>,
    private readonly maxConcurrency = 2,
  ) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error('Browser session pool concurrency must be a positive integer')
    }
  }

  async acquire(signal?: AbortSignal): Promise<BrowserSession<T>> {
    if (this.closed) throw new Error('Browser session pool is closed')
    if (signal?.aborted) throw signal.reason ?? new Error('Browser session acquisition cancelled')
    if (this.active < this.maxConcurrency) return this.createSession(signal)

    return new Promise<BrowserSession<T>>((resolve, reject) => {
      const waiter: Waiter<T> = { signal, resolve, reject }
      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(signal?.reason ?? new Error('Browser session acquisition cancelled'))
      }
      signal?.addEventListener('abort', waiter.onAbort, { once: true })
      this.waiters.push(waiter)
    })
  }

  private async createSession(signal?: AbortSignal): Promise<BrowserSession<T>> {
    if (this.closed) throw new Error('Browser session pool is closed')
    if (signal?.aborted) throw signal.reason ?? new Error('Browser session acquisition cancelled')
    this.active += 1
    try {
      const context = await this.createContext()
      if (this.closed) {
        await Promise.resolve(context.close()).catch(() => {})
        throw new Error('Browser session pool is closed')
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
        },
      }
    } catch (error) {
      this.active -= 1
      this.dispatchNext()
      throw error
    }
  }

  private dispatchNext(): void {
    if (this.closed) return
    while (this.active < this.maxConcurrency && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!
      waiter.signal?.removeEventListener('abort', waiter.onAbort!)
      if (waiter.signal?.aborted) {
        waiter.reject(waiter.signal.reason ?? new Error('Browser session acquisition cancelled'))
        continue
      }
      void this.createSession(waiter.signal).then(waiter.resolve, waiter.reject)
      break
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const waiters = this.waiters.splice(0)
    for (const waiter of waiters) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort!)
      waiter.reject(new Error('Browser session pool is closed'))
    }
    const contexts = [...this.activeContexts]
    await Promise.all(contexts.map(async (context) => {
      this.closedContexts.add(context)
      await Promise.resolve(context.close()).catch(() => {})
    }))
  }
}
