import { describe, expect, it } from 'vitest'
import { getWebBrowserConfig, getWebRoutingPolicy } from './config'

describe('web browser config', () => {
  it('defaults to a disabled, bounded browser provider', () => {
    const config = getWebBrowserConfig({})

    expect(config).toMatchObject({
      enabled: false,
      maxConcurrency: 2,
      maxViewportWidth: 1920,
      maxViewportHeight: 1080,
      maxPageHeight: 10_000,
      maxPixels: 8_000_000,
      maxArtifactBytes: 10 * 1024 * 1024,
    })
  })

  it('parses enabled provider settings and clamps unsafe values', () => {
    const config = getWebBrowserConfig({
      WEB_BROWSER_ENABLED: 'true',
      WEB_BROWSER_MAX_CONCURRENCY: '99',
      WEB_BROWSER_MAX_VIEWPORT_WIDTH: '10000',
      WEB_BROWSER_MAX_VIEWPORT_HEIGHT: '20',
      WEB_BROWSER_MAX_PAGE_HEIGHT: '100000',
      WEB_BROWSER_MAX_PIXELS: '1',
      WEB_BROWSER_MAX_ARTIFACT_BYTES: '1',
    })

    expect(config.enabled).toBe(true)
    expect(config.maxConcurrency).toBe(4)
    expect(config.maxViewportWidth).toBe(3840)
    expect(config.maxViewportHeight).toBe(240)
    expect(config.maxPageHeight).toBe(20_000)
    expect(config.maxPixels).toBe(1_000_000)
    expect(config.maxArtifactBytes).toBe(64 * 1024)
  })

  it('defaults routing to static-first auto mode with browser search disabled', () => {
    expect(getWebRoutingPolicy({})).toEqual({
      preference: 'auto',
      browserEnabled: false,
      allowSearchFallback: false,
    })
  })

  it('parses routing preference and falls back safely for invalid values', () => {
    expect(getWebRoutingPolicy({
      WEB_BROWSER_ENABLED: 'true',
      WEB_BROWSER_ROUTING: 'browser',
      WEB_SEARCH_BROWSER_FALLBACK: 'true',
    })).toEqual({
      preference: 'browser',
      browserEnabled: true,
      allowSearchFallback: true,
    })

    expect(getWebRoutingPolicy({
      WEB_BROWSER_ROUTING: 'arbitrary-provider',
      WEB_SEARCH_BROWSER_FALLBACK: 'maybe',
    })).toEqual({
      preference: 'auto',
      browserEnabled: false,
      allowSearchFallback: false,
    })
  })
})
