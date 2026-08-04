import { describe, expect, it, vi } from 'vitest'
import { allowBrowserRequest } from './agent-browser-provider'

function routeFor(url: string) {
  return {
    request: () => ({ url: () => url }),
    continue: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  } as any
}

describe('browser request guard', () => {
  it('continues safe resources and aborts unsafe resources', async () => {
    const validateUrl = vi.fn(async (url: string) => {
      if (url === 'https://example.com/app.js') return new URL(url)
      throw new Error('unsafe external URL')
    })

    const safe = routeFor('https://example.com/app.js')
    const unsafe = routeFor('http://127.0.0.1:4318/private')

    await expect(allowBrowserRequest(safe, undefined, validateUrl)).resolves.toBe(true)
    await expect(allowBrowserRequest(unsafe, undefined, validateUrl)).resolves.toBe(false)

    expect(safe.continue).toHaveBeenCalledOnce()
    expect(safe.abort).not.toHaveBeenCalled()
    expect(unsafe.abort).toHaveBeenCalledWith('blockedbyclient')
    expect(unsafe.continue).not.toHaveBeenCalled()
  })

  it('aborts new requests after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    const route = routeFor('https://example.com/app.js')

    await expect(allowBrowserRequest(route, controller.signal, async () => new URL(route.request().url()))).resolves.toBe(false)
    expect(route.abort).toHaveBeenCalledWith('aborted')
  })
})
