import { z } from 'zod'
import type { WebRoutingPolicy, WebRoutingPreference } from './contracts'

const DEFAULT_CONFIG = {
  enabled: false,
  maxConcurrency: 2,
  maxViewportWidth: 1920,
  maxViewportHeight: 1080,
  maxPageHeight: 10_000,
  maxPixels: 8_000_000,
  maxArtifactBytes: 10 * 1024 * 1024,
  timeoutMs: 60_000,
  channels: ['msedge', 'chrome'] as string[],
}

export const webBrowserConfigSchema = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.enabled),
  maxConcurrency: z.number().int().min(1).max(4).default(DEFAULT_CONFIG.maxConcurrency),
  maxViewportWidth: z.number().int().min(320).max(3840).default(DEFAULT_CONFIG.maxViewportWidth),
  maxViewportHeight: z.number().int().min(240).max(2160).default(DEFAULT_CONFIG.maxViewportHeight),
  maxPageHeight: z.number().int().min(1_000).max(20_000).default(DEFAULT_CONFIG.maxPageHeight),
  maxPixels: z.number().int().min(1_000_000).max(16_000_000).default(DEFAULT_CONFIG.maxPixels),
  maxArtifactBytes: z.number().int().min(64 * 1024).max(10 * 1024 * 1024).default(DEFAULT_CONFIG.maxArtifactBytes),
  timeoutMs: z.number().int().min(1_000).max(60_000).default(DEFAULT_CONFIG.timeoutMs),
  channels: z.array(z.string().min(1)).min(1).max(4).default(DEFAULT_CONFIG.channels),
})

export type WebBrowserConfig = z.infer<typeof webBrowserConfigSchema>

export function getWebBrowserConfig(source: Record<string, string | undefined> = process.env): WebBrowserConfig {
  const candidate = {
    enabled: parseBoolean(source.WEB_BROWSER_ENABLED, DEFAULT_CONFIG.enabled),
    maxConcurrency: clampInteger(source.WEB_BROWSER_MAX_CONCURRENCY, DEFAULT_CONFIG.maxConcurrency, 1, 4),
    maxViewportWidth: clampInteger(source.WEB_BROWSER_MAX_VIEWPORT_WIDTH, DEFAULT_CONFIG.maxViewportWidth, 320, 3840),
    maxViewportHeight: clampInteger(source.WEB_BROWSER_MAX_VIEWPORT_HEIGHT, DEFAULT_CONFIG.maxViewportHeight, 240, 2160),
    maxPageHeight: clampInteger(source.WEB_BROWSER_MAX_PAGE_HEIGHT, DEFAULT_CONFIG.maxPageHeight, 1_000, 20_000),
    maxPixels: clampInteger(source.WEB_BROWSER_MAX_PIXELS, DEFAULT_CONFIG.maxPixels, 1_000_000, 16_000_000),
    maxArtifactBytes: clampInteger(source.WEB_BROWSER_MAX_ARTIFACT_BYTES, DEFAULT_CONFIG.maxArtifactBytes, 64 * 1024, 10 * 1024 * 1024),
    timeoutMs: clampInteger(source.WEB_BROWSER_TIMEOUT_MS, DEFAULT_CONFIG.timeoutMs, 1_000, 60_000),
    channels: parseChannels(source.WEB_BROWSER_CHANNELS),
  }
  const parsed = webBrowserConfigSchema.safeParse(candidate)
  return parsed.success ? parsed.data : webBrowserConfigSchema.parse(DEFAULT_CONFIG)
}

export function getWebRoutingPolicy(source: Record<string, string | undefined> = process.env): WebRoutingPolicy {
  const preference = parseRoutingPreference(source.WEB_BROWSER_ROUTING)
  const browserConfig = getWebBrowserConfig(source)
  return {
    preference,
    browserEnabled: browserConfig.enabled,
    allowSearchFallback: parseBoolean(source.WEB_SEARCH_BROWSER_FALLBACK, false),
  }
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function parseRoutingPreference(value: string | undefined): WebRoutingPreference {
  if (value === 'static' || value === 'browser' || value === 'auto') return value
  return 'auto'
}

function clampInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(parsed)))
}

function parseChannels(value: string | undefined): string[] {
  if (!value?.trim()) return [...DEFAULT_CONFIG.channels]
  const channels = value.split(',').map((channel) => channel.trim()).filter(Boolean)
  return channels.length > 0 ? channels.slice(0, 4) : [...DEFAULT_CONFIG.channels]
}
