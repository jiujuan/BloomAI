import { describe, expect, it } from 'vitest'
import { readBodyLimited } from './html'

describe('stream resource limits', () => {
  it('cancels the response reader when the byte limit is reached', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('0123456789'))
      },
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('abcdefghij'))
      },
      cancel() {
        cancelled = true
      },
    })

    const result = await readBodyLimited(new Response(body), 12)

    expect(result.truncated).toBe(true)
    expect(result.bytes.byteLength).toBe(12)
    expect(cancelled).toBe(true)
  })
})
