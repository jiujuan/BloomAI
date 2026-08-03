import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBinaryLimited,
  MAX_IMAGE_BYTES,
  readBinaryFileLimited,
  readBinaryResponseLimited,
} from './binary-limit'

describe('binary resource limits', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cancels a response reader when the byte limit is reached', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8))
      },
      pull(controller) {
        controller.enqueue(new Uint8Array(8))
      },
      cancel() {
        cancelled = true
      },
    })

    const result = await readBinaryResponseLimited(new Response(body), 10)

    expect(result.truncated).toBe(true)
    expect(result.bytes.byteLength).toBe(10)
    expect(cancelled).toBe(true)
  })

  it('rejects an oversized local binary before reading it into memory', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-binary-limit-'))
    const filePath = path.join(tempDir, 'large.bin')
    fs.writeFileSync(filePath, Buffer.alloc(MAX_IMAGE_BYTES + 1))

    await expect(readBinaryFileLimited(filePath, MAX_IMAGE_BYTES)).rejects.toThrow(/exceeds/i)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('revalidates every redirect and enforces an image content type', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://cdn.example/image.png' },
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/png' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchBinaryLimited('https://public.example/image', {
      lookup: async (hostname) => hostname === 'public.example' || hostname === 'cdn.example' ? ['93.184.216.34'] : [],
      allowedMimeTypes: ['image/png'],
      maxBytes: MAX_IMAGE_BYTES,
    })

    expect(result.finalUrl).toBe('https://cdn.example/image.png')
    expect(result.contentType).toBe('image/png')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects a non-image response before consuming its body', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })))

    await expect(fetchBinaryLimited('https://public.example/image', {
      lookup: async () => ['93.184.216.34'],
      allowedMimeTypes: ['image/png', 'image/jpeg'],
    })).rejects.toThrow(/content type/i)
    expect(cancel).toHaveBeenCalled()
  })
})
