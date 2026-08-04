import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPage } from './html'

describe('fetchPage URL policy integration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not request a private redirect target', async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1:4318/private' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchPage('https://public.example.test/start', {
      lookup: async () => ['93.184.216.34'],
    })).rejects.toThrow('private or local')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
