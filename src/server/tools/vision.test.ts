import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/repositories/settings.repo', () => ({
  settingsRepo: { getValue: () => 'test-anthropic-key' },
}))

vi.mock('./utils/binary-limit', async () => {
  const actual = await vi.importActual<typeof import('./utils/binary-limit')>('./utils/binary-limit')
  return {
    ...actual,
    fetchBinaryLimited: vi.fn(),
  }
})

import { fetchBinaryLimited } from './utils/binary-limit'
import { visionTool } from './vision'

describe('visionTool resource boundaries', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads a local image only inside approved roots and sends its bounded bytes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-vision-root-'))
    const imagePath = path.join(root, 'image.png')
    fs.writeFileSync(imagePath, Buffer.from([1, 2, 3, 4]))
    const fetchMock = vi.fn(async () => Response.json({ content: [{ text: 'A small image' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const output = await visionTool(
      { imagePath: 'image.png', question: 'What is this?' },
      { toolId: 'vision', allowedRoots: [root] },
    )

    expect(output).toEqual({ description: 'A small image', model: 'claude-3-5-sonnet-20241022' })
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo, RequestInit]>
    const body = JSON.parse(calls[0][1].body as string)
    expect(body.messages[0].content[0]).toMatchObject({
      type: 'image',
      source: { media_type: 'image/png', data: Buffer.from([1, 2, 3, 4]).toString('base64') },
    })
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('rejects a local image outside approved roots', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-vision-root-'))
    const outside = path.join(os.tmpdir(), `bloomai-vision-outside-${Date.now()}.png`)
    fs.writeFileSync(outside, Buffer.from([1]))

    await expect(visionTool(
      { imagePath: outside },
      { toolId: 'vision', allowedRoots: [root] },
    )).rejects.toThrow(/outside approved roots/i)

    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { force: true })
  })

  it('validates and bounds a remote image before calling Anthropic', async () => {
    vi.mocked(fetchBinaryLimited).mockResolvedValue({
      url: 'https://public.example/image.png',
      finalUrl: 'https://cdn.example/image.png',
      contentType: 'image/png',
      bytes: new Uint8Array([9, 8, 7]),
      bytesRead: 3,
      truncated: false,
    })
    const fetchMock = vi.fn(async () => Response.json({ content: [{ text: 'Remote image' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(visionTool(
      { imageUrl: 'https://public.example/image.png' },
      { toolId: 'vision' },
    )).resolves.toMatchObject({ description: 'Remote image' })

    expect(fetchBinaryLimited).toHaveBeenCalledWith('https://public.example/image.png', expect.objectContaining({
      maxBytes: 10 * 1024 * 1024,
      allowedMimeTypes: expect.arrayContaining(['image/png']),
    }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
