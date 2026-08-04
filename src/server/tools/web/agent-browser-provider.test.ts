import { describe, expect, it, vi } from 'vitest'
import { AgentBrowserProvider } from './agent-browser-provider'
import { WebBrowserError } from './browser-errors'
import { getWebBrowserConfig } from './config'

type FakeBrowserOptions = {
  slowNavigation?: boolean
  navigationError?: Error
  html?: string
  finalUrl?: string
  screenshotBytes?: Buffer
  documentHeight?: number
}

function createFakeBrowser(options: FakeBrowserOptions = {}) {
  let rejectNavigation: ((error: Error) => void) | undefined
  let pageClosed = false
  const page = {
    route: vi.fn(async () => {}),
    goto: vi.fn(async () => {
      if (options.navigationError) throw options.navigationError
      if (!options.slowNavigation) {
        return {
          status: () => 201,
          url: () => options.finalUrl ?? 'https://example.com/rendered',
        }
      }
      return new Promise<{ status: () => number; url: () => string }>((resolve, reject) => {
        rejectNavigation = reject
        if (pageClosed) reject(new Error('Target page has been closed'))
        else void resolve
      })
    }),
    waitForSelector: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    content: vi.fn(async () => options.html ?? '<main>rendered browser content</main>'),
    url: vi.fn(() => options.finalUrl ?? 'https://example.com/rendered'),
    close: vi.fn(async () => {
      pageClosed = true
      rejectNavigation?.(new Error('Target page has been closed'))
    }),
    setViewportSize: vi.fn(async () => {}),
    evaluate: vi.fn(async () => options.documentHeight ?? 640),
    screenshot: vi.fn(async () => options.screenshotBytes ?? Buffer.from([137, 80, 78, 71])),
  }
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  }
  const browser = {
    isConnected: vi.fn(() => true),
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {}),
  }
  return { browser, context, page }
}

function createConfig(overrides: Record<string, string> = {}) {
  return getWebBrowserConfig({
    WEB_BROWSER_ENABLED: 'true',
    WEB_BROWSER_MAX_CONCURRENCY: '2',
    WEB_BROWSER_IDLE_TIMEOUT_MS: '0',
    ...overrides,
  })
}

const validateUrl = async (rawUrl: string): Promise<URL> => {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:') throw new Error('unsafe external URL')
  return url
}

describe('AgentBrowserProvider', () => {
  it('loads rendered HTML through an isolated context and closes page/context', async () => {
    const fake = createFakeBrowser({
      html: '<main>Hydrated fixture</main>',
      finalUrl: 'https://example.com/rendered?secret=1',
    })
    const provider = new AgentBrowserProvider({
      config: createConfig(),
      launchBrowser: vi.fn(async () => fake.browser as any),
      validateUrl,
    })

    const result = await provider.load({
      url: 'https://example.com/app',
      timeoutMs: 1_000,
    })

    expect(result).toMatchObject({
      html: '<main>Hydrated fixture</main>',
      finalUrl: 'https://example.com/rendered?secret=1',
      status: 201,
      rendered: true,
      provider: 'agent_browser',
    })
    expect(fake.browser.newContext).toHaveBeenCalledOnce()
    expect(fake.context.newPage).toHaveBeenCalledOnce()
    expect(fake.page.close).toHaveBeenCalledOnce()
    expect(fake.context.close).toHaveBeenCalledOnce()
    expect(JSON.stringify(result.diagnostics)).not.toContain('secret=1')

    await provider.close()
    expect(fake.browser.close).toHaveBeenCalledOnce()
  })

  it('captures bounded PNG metadata and releases the browser session', async () => {
    const fake = createFakeBrowser({ documentHeight: 900, screenshotBytes: Buffer.from('png') })
    const provider = new AgentBrowserProvider({
      config: createConfig(),
      launchBrowser: vi.fn(async () => fake.browser as any),
      validateUrl,
    })

    const result = await provider.screenshot({
      url: 'https://example.com/app',
      fullPage: true,
      viewport: { width: 800, height: 600 },
      format: 'png',
      timeoutMs: 1_000,
    })

    expect(result).toMatchObject({
      mimeType: 'image/png',
      width: 800,
      height: 900,
      finalUrl: 'https://example.com/rendered',
      provider: 'agent_browser',
    })
    expect(result.bytes).toEqual(Buffer.from('png'))
    expect(fake.page.screenshot).toHaveBeenCalledWith({ fullPage: true, type: 'png' })
    expect(fake.page.close).toHaveBeenCalledOnce()
    expect(fake.context.close).toHaveBeenCalledOnce()
    await provider.close()
  })

  it('maps navigation failures and unavailable browsers to stable errors', async () => {
    const failure = createFakeBrowser({ navigationError: new Error('navigation failed for https://example.com?token=secret') })
    const failureProvider = new AgentBrowserProvider({
      config: createConfig(),
      launchBrowser: vi.fn(async () => failure.browser as any),
      validateUrl,
    })
    await expect(failureProvider.load({ url: 'https://example.com/app' })).rejects.toMatchObject({
      code: 'WEB_BROWSER_NAVIGATION_FAILED',
    } satisfies Partial<WebBrowserError>)
    await failureProvider.close()

    const unavailableProvider = new AgentBrowserProvider({
      config: createConfig(),
      launchBrowser: vi.fn(async () => {
        throw new Error('executable C:\\private\\browser.exe was not found')
      }),
      validateUrl,
    })
    await expect(unavailableProvider.checkAvailability()).resolves.toEqual({
      available: false,
      reason: 'no configured system browser could be launched',
    })
    await unavailableProvider.close()
  })

  it('aborts an in-flight navigation and releases page/context without starting another session', async () => {
    const fake = createFakeBrowser({ slowNavigation: true })
    const launchBrowser = vi.fn(async () => fake.browser as any)
    const provider = new AgentBrowserProvider({
      config: createConfig(),
      launchBrowser,
      validateUrl,
    })
    const controller = new AbortController()
    const pending = provider.load({
      url: 'https://example.com/slow',
      signal: controller.signal,
      timeoutMs: 1_000,
    })

    await Promise.resolve()
    controller.abort(new Error('cancelled by test'))

    await expect(pending).rejects.toMatchObject({ code: 'WEB_BROWSER_ABORTED' })
    expect(fake.page.close).toHaveBeenCalled()
    expect(fake.context.close).toHaveBeenCalledOnce()
    expect(launchBrowser).toHaveBeenCalledOnce()
    await provider.close()
  })

  it('does not launch a browser while disabled', async () => {
    const launchBrowser = vi.fn(async () => createFakeBrowser().browser as any)
    const provider = new AgentBrowserProvider({
      config: getWebBrowserConfig({}),
      launchBrowser,
      validateUrl,
    })

    await expect(provider.checkAvailability()).resolves.toEqual({
      available: false,
      reason: 'WEB_BROWSER_ENABLED is false',
    })
    await expect(provider.load({ url: 'https://example.com' })).rejects.toMatchObject({
      code: 'WEB_BROWSER_DISABLED',
    } satisfies Partial<WebBrowserError>)
    expect(launchBrowser).not.toHaveBeenCalled()
    await provider.close()
  })
})
