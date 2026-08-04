import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebScreenshotTool } from './web-screenshot'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('webScreenshotTool', () => {
  it('writes a bounded screenshot artifact below the application data directory', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-web-screenshot-'))
    tempDirs.push(dataDir)
    const provider = {
      screenshot: vi.fn(async () => ({
        bytes: Buffer.from('fake-png'),
        mimeType: 'image/png' as const,
        width: 800,
        height: 600,
        finalUrl: 'https://example.com/final',
        provider: 'agent_browser' as const,
        diagnostics: { attempts: [] },
      })),
    }

    const tool = createWebScreenshotTool({ provider, dataDir })
    const result = await tool(
      { url: 'https://example.com', fullPage: false, viewport: { width: 800, height: 600 } },
      { toolId: 'web_screenshot', requestId: 'run-1' },
    )

    expect(result).toMatchObject({
      mimeType: 'image/png',
      width: 800,
      height: 600,
      finalUrl: 'https://example.com/final',
      provider: 'agent_browser',
    })
    expect(result.bytes).toBe(8)
    expect(result.imagePath).toBe(path.join(dataDir, 'tool-artifacts', 'web-screenshot', 'run-1', 'screenshot.png'))
    expect(fs.readFileSync(result.imagePath)).toEqual(Buffer.from('fake-png'))
  })

  it('does not allow a caller-supplied output path or oversized screenshot', async () => {
    const provider = {
      screenshot: vi.fn(async () => ({
        bytes: Buffer.alloc(20),
        mimeType: 'image/png' as const,
        width: 100,
        height: 100,
        finalUrl: 'https://example.com',
        provider: 'agent_browser' as const,
        diagnostics: { attempts: [] },
      })),
    }
    const tool = createWebScreenshotTool({
      provider,
      dataDir: os.tmpdir(),
      limits: { maxArtifactBytes: 10 },
    })

    await expect(tool(
      { url: 'https://example.com', outputPath: 'C:\\outside.png' },
      { toolId: 'web_screenshot', requestId: 'run-2' },
    )).rejects.toThrow(/artifact/i)
  })
})
