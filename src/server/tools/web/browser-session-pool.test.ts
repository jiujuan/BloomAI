import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserSessionPool } from './browser-session-pool'

describe('BrowserSessionPool', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('bounds concurrent sessions and releases the next waiter', async () => {
    const contexts = [
      { close: vi.fn(async () => {}) },
      { close: vi.fn(async () => {}) },
    ]
    let index = 0
    const pool = new BrowserSessionPool(async () => contexts[index++], 1)

    const first = await pool.acquire()
    let secondResolved = false
    const secondPromise = pool.acquire().then((session) => {
      secondResolved = true
      return session
    })

    await Promise.resolve()
    expect(secondResolved).toBe(false)
    await first.release()
    const second = await secondPromise
    expect(secondResolved).toBe(true)
    await second.release()
    expect(contexts[0].close).toHaveBeenCalledTimes(1)
    expect(contexts[1].close).toHaveBeenCalledTimes(1)
  })

  it('cancels a queued acquisition without consuming a slot', async () => {
    const firstContext = { close: vi.fn(async () => {}) }
    const pool = new BrowserSessionPool(async () => firstContext, 1)
    const first = await pool.acquire()
    const controller = new AbortController()
    const pending = pool.acquire(controller.signal)

    controller.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
    await first.release()
    expect(firstContext.close).toHaveBeenCalledTimes(1)
  })

  it('closes active contexts and rejects queued work during shutdown', async () => {
    const firstContext = { close: vi.fn(async () => {}) }
    const pool = new BrowserSessionPool(async () => firstContext, 1)
    const first = await pool.acquire()
    const pending = pool.acquire()

    const closePromise = pool.close()

    await expect(pending).rejects.toThrow(/closed/i)
    await closePromise
    expect(firstContext.close).toHaveBeenCalledTimes(1)

    await first.release()
    expect(firstContext.close).toHaveBeenCalledTimes(1)
    await expect(pool.acquire()).rejects.toThrow(/closed/i)
  })

  it('maps a queued request to a stable queue timeout without creating a context', async () => {
    vi.useFakeTimers()
    const firstContext = { close: vi.fn(async () => {}) }
    const createContext = vi.fn(async () => firstContext)
    const pool = new BrowserSessionPool(createContext, {
      maxConcurrency: 1,
      queueTimeoutMs: 25,
    })
    const first = await pool.acquire()
    const pending = expect(pool.acquire()).rejects.toThrow('WEB_BROWSER_QUEUE_TIMEOUT')

    await vi.advanceTimersByTimeAsync(25)

    await pending
    expect(createContext).toHaveBeenCalledTimes(1)
    await first.release()
  })

  it('runs the idle callback after the last session is released', async () => {
    vi.useFakeTimers()
    const context = { close: vi.fn(async () => {}) }
    const onIdle = vi.fn()
    const pool = new BrowserSessionPool(async () => context, {
      maxConcurrency: 1,
      idleTimeoutMs: 20,
      onIdle,
    })

    const session = await pool.acquire()
    await session.release()
    expect(onIdle).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(20)
    expect(onIdle).toHaveBeenCalledOnce()
  })
})
