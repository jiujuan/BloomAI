import { getDataDir } from '../db/paths'
import type { ToolExecutor } from './types'
import { AgentBrowserProvider } from './web/agent-browser-provider'
import { WebBrowserError } from './web/browser-errors'
import { getWebBrowserConfig } from './web/config'
import type { WebScreenshotProvider } from './web/contracts'
import { writeScreenshotArtifact } from './web/screenshot-artifacts'

export type WebScreenshotInput = {
  url: string
  fullPage?: boolean
  viewport?: { width: number; height: number }
  format?: 'png' | 'jpeg'
  quality?: number
  timeoutMs?: number
  /** Accepted for compatibility only; output is always application-controlled. */
  outputPath?: string
}

export type WebScreenshotOutput = {
  imagePath: string
  mimeType: 'image/png' | 'image/jpeg'
  width: number
  height: number
  bytes: number
  finalUrl: string
  provider: 'agent_browser' | 'playwright_legacy'
  diagnostics: {
    attempts: Array<{ provider: string; outcome: string; reason?: string; durationMs?: number }>
    blockedRequests?: number
  }
}

export type WebScreenshotToolOptions = {
  provider?: WebScreenshotProvider
  dataDir?: string
  limits?: {
    maxViewportWidth?: number
    maxViewportHeight?: number
    maxPageHeight?: number
    maxPixels?: number
    maxArtifactBytes?: number
    retentionCount?: number
    timeoutMs?: number
  }
}

export function createWebScreenshotTool(options: WebScreenshotToolOptions = {}): ToolExecutor<WebScreenshotInput, WebScreenshotOutput> {
  const config = getWebBrowserConfig()
  const limits = {
    maxViewportWidth: options.limits?.maxViewportWidth ?? config.maxViewportWidth,
    maxViewportHeight: options.limits?.maxViewportHeight ?? config.maxViewportHeight,
    maxPageHeight: options.limits?.maxPageHeight ?? config.maxPageHeight,
    maxPixels: options.limits?.maxPixels ?? config.maxPixels,
    maxArtifactBytes: options.limits?.maxArtifactBytes ?? config.maxArtifactBytes,
    retentionCount: options.limits?.retentionCount ?? 20,
    timeoutMs: options.limits?.timeoutMs ?? config.timeoutMs,
  }
  const provider = options.provider ?? new AgentBrowserProvider({ config })
  const dataDir = options.dataDir ?? getDataDir()

  return async (input, context) => {
    throwIfAborted(context.signal)
    const viewport = input.viewport ?? { width: 1280, height: 720 }
    const format = input.format ?? 'png'
    const timeoutMs = Math.min(input.timeoutMs ?? 60_000, limits.timeoutMs)
    if (viewport.width > limits.maxViewportWidth || viewport.height > limits.maxViewportHeight) {
      throwScreenshotLimit('viewport exceeds the configured limit')
    }
    if (input.fullPage && viewport.width * limits.maxPageHeight > limits.maxPixels) {
      throwScreenshotLimit('full-page screenshot pixel budget is too large')
    }

    const result = await provider.screenshot({
      url: input.url,
      fullPage: input.fullPage ?? true,
      viewport,
      format,
      quality: input.quality,
      timeoutMs,
      signal: context.signal,
    })
    if (result.height > limits.maxPageHeight || result.width * result.height > limits.maxPixels) {
      throwScreenshotLimit('screenshot dimensions exceed the configured limit')
    }
    const artifact = await writeScreenshotArtifact({
      bytes: result.bytes,
      mimeType: result.mimeType,
      dataDir,
      runId: context.requestId,
      maxBytes: limits.maxArtifactBytes,
      signal: context.signal,
      retentionCount: limits.retentionCount,
    })
    return {
      imagePath: artifact.imagePath,
      mimeType: artifact.mimeType,
      width: result.width,
      height: result.height,
      bytes: artifact.bytes,
      finalUrl: result.finalUrl,
      provider: result.provider,
      diagnostics: result.diagnostics,
    }
  }
}

export const webScreenshotTool = createWebScreenshotTool()

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new WebBrowserError('WEB_BROWSER_ABORTED', 'screenshot operation was cancelled', signal.reason)
}

function throwScreenshotLimit(message: string): never {
  throw new WebBrowserError('WEB_SCREENSHOT_LIMIT_EXCEEDED', message)
}
