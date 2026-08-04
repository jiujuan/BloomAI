import { describe, expect, it, vi } from 'vitest'
import type { WebLoadedPage, WebPageProvider } from './contracts'
import { createWebPageProviderRouter } from './provider-router'
import { WebBrowserError } from './browser-errors'
import { UrlPolicyError } from './url-policy'

const enabledAutoPolicy = {
  preference: 'auto' as const,
  browserEnabled: true,
  allowSearchFallback: false,
}

function page(provider: WebLoadedPage['provider'], html: string): WebLoadedPage {
  return {
    html,
    finalUrl: 'https://example.com/final',
    status: 200,
    charset: 'utf-8',
    rendered: provider !== 'static_http',
    provider,
    diagnostics: { attempts: [] },
  }
}

describe('web provider router', () => {
  it('keeps a substantial static result without opening a browser', async () => {
    const staticProvider: WebPageProvider = {
      id: 'static_http',
      load: vi.fn(async () => page('static_http', `<main>${'article text '.repeat(40)}</main>`)),
    }
    const browserProvider: WebPageProvider = {
      id: 'agent_browser',
      load: vi.fn(async () => page('agent_browser', '<main>rendered</main>')),
    }

    const result = await createWebPageProviderRouter({ staticProvider, browserProvider, routingPolicy: enabledAutoPolicy }).loadPage({
      url: 'https://example.com',
    })

    expect(result.provider).toBe('static_http')
    expect(browserProvider.load).not.toHaveBeenCalled()
    expect(result.diagnostics.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'agent_browser',
        outcome: 'skipped',
        reason: 'static_content_sufficient',
      }),
    ]))
  })

  it('uses the browser only for thin auto pages and preserves static output on browser failure', async () => {
    const staticResult = page('static_http', '<main>thin</main>')
    const staticProvider: WebPageProvider = {
      id: 'static_http',
      load: vi.fn(async () => staticResult),
    }
    const browserProvider: WebPageProvider = {
      id: 'agent_browser',
      load: vi.fn(async () => { throw new Error('browser unavailable') }),
    }

    const result = await createWebPageProviderRouter({ staticProvider, browserProvider, routingPolicy: enabledAutoPolicy }).loadPage({
      url: 'https://example.com',
    })

    expect(result).toMatchObject({
      html: staticResult.html,
      finalUrl: staticResult.finalUrl,
      status: staticResult.status,
      charset: staticResult.charset,
      rendered: staticResult.rendered,
      provider: staticResult.provider,
    })
    expect(result.diagnostics.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'agent_browser', outcome: 'failed' }),
    ]))
    expect(browserProvider.load).toHaveBeenCalledTimes(1)
  })

  it('honors explicit static and browser preferences', async () => {
    const staticProvider: WebPageProvider = {
      id: 'static_http',
      load: vi.fn(async () => page('static_http', '<main>static</main>')),
    }
    const browserProvider: WebPageProvider = {
      id: 'agent_browser',
      load: vi.fn(async () => page('agent_browser', '<main>browser</main>')),
    }
    const router = createWebPageProviderRouter({ staticProvider, browserProvider, routingPolicy: enabledAutoPolicy })

    const staticResult = await router.loadPage({ url: 'https://example.com', render: false })
    const browserResult = await router.loadPage({ url: 'https://example.com', render: true })

    expect(staticResult.provider).toBe('static_http')
    expect(browserResult.provider).toBe('agent_browser')
    expect(staticProvider.load).toHaveBeenCalledTimes(1)
    expect(browserProvider.load).toHaveBeenCalledTimes(1)
  })

  it('records browser unavailability and preserves a usable static result in auto mode', async () => {
    const staticProvider: WebPageProvider = {
      id: 'static_http',
      load: vi.fn(async () => page('static_http', '<main>thin</main>')),
    }
    const browserProvider: WebPageProvider = {
      id: 'agent_browser',
      checkAvailability: vi.fn(async () => ({ available: false, reason: 'disabled by configuration' })),
      load: vi.fn(async () => page('agent_browser', '<main>never</main>')),
    }

    const result = await createWebPageProviderRouter({ staticProvider, browserProvider, routingPolicy: enabledAutoPolicy }).loadPage({
      url: 'https://example.com',
    })

    expect(result.provider).toBe('static_http')
    expect(browserProvider.load).not.toHaveBeenCalled()
    expect(result.diagnostics.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'agent_browser',
        outcome: 'skipped',
        reason: 'unavailable: disabled by configuration',
      }),
    ]))
  })

  it('returns a stable unavailable error for a forced browser route', async () => {
    const staticProvider: WebPageProvider = {
      id: 'static_http',
      load: vi.fn(async () => page('static_http', '<main>static</main>')),
    }
    const browserProvider: WebPageProvider = {
      id: 'agent_browser',
      checkAvailability: vi.fn(async () => ({ available: false, reason: 'missing browser binary' })),
      load: vi.fn(async () => page('agent_browser', '<main>never</main>')),
    }

    await expect(createWebPageProviderRouter({
      staticProvider,
      browserProvider,
      routingPolicy: enabledAutoPolicy,
    }).loadPage({
      url: 'https://example.com',
      render: true,
    })).rejects.toMatchObject({
      code: 'WEB_BROWSER_UNAVAILABLE',
      message: expect.stringContaining('missing browser binary'),
    } satisfies Partial<WebBrowserError>)

    expect(staticProvider.load).not.toHaveBeenCalled()
    expect(browserProvider.load).not.toHaveBeenCalled()
  })

  it('checks browser availability before falling back after a static fetch failure', async () => {
    const staticProvider: WebPageProvider = {
      id: 'static_http',
      load: vi.fn(async () => { throw new Error('upstream connection reset') }),
    }
    const browserProvider: WebPageProvider = {
      id: 'agent_browser',
      checkAvailability: vi.fn(async () => ({ available: false, reason: 'missing browser binary' })),
      load: vi.fn(async () => page('agent_browser', '<main>never</main>')),
    }

    await expect(createWebPageProviderRouter({
      staticProvider,
      browserProvider,
      routingPolicy: enabledAutoPolicy,
    }).loadPage({ url: 'https://example.com' })).rejects.toMatchObject({
      code: 'WEB_BROWSER_UNAVAILABLE',
    } satisfies Partial<WebBrowserError>)
    expect(browserProvider.checkAvailability).toHaveBeenCalledOnce()
    expect(browserProvider.load).not.toHaveBeenCalled()
  })

  it('does not retry an unsafe static URL through the browser', async () => {
    const staticProvider: WebPageProvider = {
      id: 'static_http',
      load: vi.fn(async () => { throw new UrlPolicyError('private or local host') }),
    }
    const browserProvider: WebPageProvider = {
      id: 'agent_browser',
      checkAvailability: vi.fn(async () => ({ available: true })),
      load: vi.fn(async () => page('agent_browser', '<main>never</main>')),
    }

    await expect(createWebPageProviderRouter({
      staticProvider,
      browserProvider,
      routingPolicy: enabledAutoPolicy,
    }).loadPage({ url: 'https://example.com' })).rejects.toBeInstanceOf(UrlPolicyError)
    expect(browserProvider.checkAvailability).not.toHaveBeenCalled()
    expect(browserProvider.load).not.toHaveBeenCalled()
  })
})
