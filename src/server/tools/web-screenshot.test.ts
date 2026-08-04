import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebScreenshotTool } from './web-screenshot'
import { pruneScreenshotArtifacts, readScreenshotArtifact, writeScreenshotArtifact } from './web/screenshot-artifacts'
import { WebBrowserError } from './web/browser-errors'

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
      { toolId: 'web_screenshot', toolRunId: 'run-1' },
    )

    expect(result).toMatchObject({
      mimeType: 'image/png',
      width: 800,
      height: 600,
      finalUrl: 'https://example.com/final',
      provider: 'agent_browser',
    })
    expect(result.bytes).toBe(8)
    expect(result).toEqual(expect.objectContaining({
      runId: 'run-1',
      relativePath: 'tool-artifacts/web-screenshot/run-1/screenshot.png',
      mimeType: 'image/png',
      bytes: 8,
    }))
    expect(result).not.toHaveProperty('imagePath')
    await expect(readScreenshotArtifact({ dataDir, runId: 'run-1', relativePath: result.relativePath }))
      .resolves.toMatchObject({ bytes: Buffer.from('fake-png'), mimeType: 'image/png', bytesCount: 8 })
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
      { toolId: 'web_screenshot', toolRunId: 'run-2' },
    )).rejects.toMatchObject({ code: 'WEB_SCREENSHOT_LIMIT_EXCEEDED' })
  })

  it('supports JPEG output and passes quality/fullPage controls to the provider', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-web-screenshot-jpeg-'))
    tempDirs.push(dataDir)
    const provider = {
      screenshot: vi.fn(async () => ({
        bytes: Buffer.from('fake-jpeg'),
        mimeType: 'image/jpeg' as const,
        width: 640,
        height: 480,
        finalUrl: 'https://example.com/final',
        provider: 'agent_browser' as const,
        diagnostics: { attempts: [] },
      })),
    }
    const tool = createWebScreenshotTool({
      provider,
      dataDir,
      limits: { maxPixels: 640 * 480 },
    })

    const result = await tool(
      { url: 'https://example.com', fullPage: false, viewport: { width: 640, height: 480 }, format: 'jpeg', quality: 82 },
      { toolId: 'web_screenshot', requestId: 'jpeg-run' },
    )

    expect(provider.screenshot).toHaveBeenCalledWith(expect.objectContaining({
      fullPage: false,
      format: 'jpeg',
      quality: 82,
      viewport: { width: 640, height: 480 },
    }))
    expect(result.mimeType).toBe('image/jpeg')
    expect(result.relativePath).toBe('tool-artifacts/web-screenshot/jpeg-run/screenshot.jpg')
  })

  it('rejects oversized dimensions with a stable screenshot limit code before writing', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-web-screenshot-dimensions-'))
    tempDirs.push(dataDir)
    const provider = {
      screenshot: vi.fn(async () => ({
        bytes: Buffer.from('png'),
        mimeType: 'image/png' as const,
        width: 1_000,
        height: 1_000,
        finalUrl: 'https://example.com',
        provider: 'agent_browser' as const,
        diagnostics: { attempts: [] },
      })),
    }
    const tool = createWebScreenshotTool({
      provider,
      dataDir,
      limits: { maxPixels: 100_000 },
    })

    await expect(tool(
      { url: 'https://example.com', fullPage: false, viewport: { width: 800, height: 600 } },
      { toolId: 'web_screenshot', toolRunId: 'dimension-run' },
    )).rejects.toMatchObject({ code: 'WEB_SCREENSHOT_LIMIT_EXCEEDED' })
    expect(fs.existsSync(path.join(dataDir, 'tool-artifacts'))).toBe(false)
  })

  it('does not leave an artifact or temporary file when cancelled before writing', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-web-screenshot-abort-'))
    tempDirs.push(dataDir)
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    const provider = {
      screenshot: vi.fn(async () => ({
        bytes: Buffer.from('png'),
        mimeType: 'image/png' as const,
        width: 400,
        height: 300,
        finalUrl: 'https://example.com',
        provider: 'agent_browser' as const,
        diagnostics: { attempts: [] },
      })),
    }
    const tool = createWebScreenshotTool({ provider, dataDir })

    await expect(tool(
      { url: 'https://example.com', fullPage: false, viewport: { width: 400, height: 300 } },
      { toolId: 'web_screenshot', toolRunId: 'abort-run', signal: controller.signal },
    )).rejects.toMatchObject({ code: 'WEB_BROWSER_ABORTED' })
    expect(provider.screenshot).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(dataDir, 'tool-artifacts'))).toBe(false)
  })
})

describe('screenshot artifacts', () => {
  it('writes atomically, replaces an existing run artifact, and removes temporary files', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-screenshot-artifact-'))
    tempDirs.push(dataDir)
    const first = await writeScreenshotArtifact({
      bytes: Buffer.from('first'),
      mimeType: 'image/png',
      dataDir,
      runId: 'atomic-run',
      maxBytes: 100,
    })
    const second = await writeScreenshotArtifact({
      bytes: Buffer.from('second'),
      mimeType: 'image/png',
      dataDir,
      runId: 'atomic-run',
      maxBytes: 100,
    })

    expect(second.relativePath).toBe(first.relativePath)
    const absolutePath = path.join(dataDir, ...second.relativePath.split('/'))
    expect(fs.readFileSync(absolutePath, 'utf8')).toBe('second')
    expect(fs.readdirSync(path.dirname(absolutePath))).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/\.tmp$/),
    ]))
  })

  it('rejects traversal, cross-run, and cross-tool artifact reads', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-screenshot-artifact-security-'))
    tempDirs.push(dataDir)
    const artifact = await writeScreenshotArtifact({
      bytes: Buffer.from('png'),
      mimeType: 'image/png',
      dataDir,
      runId: 'run-a',
      maxBytes: 100,
    })

    await expect(readScreenshotArtifact({
      dataDir,
      runId: 'run-a',
      relativePath: '../run-b/screenshot.png',
    })).rejects.toThrow(/artifact path|run/i)
    await expect(readScreenshotArtifact({
      dataDir,
      runId: 'run-b',
      relativePath: artifact.relativePath,
    })).rejects.toThrow(/artifact path|run/i)
    await expect(readScreenshotArtifact({
      dataDir,
      runId: 'run-a',
      relativePath: 'tool-artifacts/other-tool/run-a/screenshot.png',
    })).rejects.toThrow(/artifact path|tool/i)
  })

  it('prunes old run directories while retaining the current run', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-screenshot-prune-'))
    tempDirs.push(dataDir)
    for (const runId of ['old-a', 'old-b', 'current']) {
      await writeScreenshotArtifact({
        bytes: Buffer.from(runId),
        mimeType: 'image/png',
        dataDir,
        runId,
        maxBytes: 100,
        retentionCount: 10,
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    await pruneScreenshotArtifacts({ dataDir, maxRuns: 1, keepRunId: 'current' })

    const root = path.join(dataDir, 'tool-artifacts', 'web-screenshot')
    expect(fs.readdirSync(root)).toEqual(expect.arrayContaining(['current']))
    expect(fs.readdirSync(root)).toHaveLength(1)
  })

  it('maps artifact size violations and cancellation to stable errors', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-screenshot-artifact-errors-'))
    tempDirs.push(dataDir)
    await expect(writeScreenshotArtifact({
      bytes: Buffer.alloc(11),
      mimeType: 'image/png',
      dataDir,
      runId: 'too-large',
      maxBytes: 10,
    })).rejects.toMatchObject({ code: 'WEB_SCREENSHOT_LIMIT_EXCEEDED' })

    const controller = new AbortController()
    controller.abort()
    await expect(writeScreenshotArtifact({
      bytes: Buffer.from('png'),
      mimeType: 'image/png',
      dataDir,
      runId: 'cancelled',
      maxBytes: 100,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'WEB_BROWSER_ABORTED' } satisfies Partial<WebBrowserError>)
    expect(fs.existsSync(path.join(dataDir, 'tool-artifacts'))).toBe(false)
  })
})
