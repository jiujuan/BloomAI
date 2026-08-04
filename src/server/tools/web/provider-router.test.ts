import { describe, expect, it, vi } from 'vitest'
import type { WebLoadedPage, WebPageProvider } from './contracts'
import { createWebPageProviderRouter } from './provider-router'

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

    const result = await createWebPageProviderRouter({ staticProvider, browserProvider }).loadPage({
      url: 'https://example.com',
    })

    expect(result.provider).toBe('static_http')
    expect(browserProvider.load).not.toHaveBeenCalled()
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

    const result = await createWebPageProviderRouter({ staticProvider, browserProvider }).loadPage({
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
    const router = createWebPageProviderRouter({ staticProvider, browserProvider })

    const staticResult = await router.loadPage({ url: 'https://example.com', render: false })
    const browserResult = await router.loadPage({ url: 'https://example.com', render: true })

    expect(staticResult.provider).toBe('static_http')
    expect(browserResult.provider).toBe('agent_browser')
    expect(staticProvider.load).toHaveBeenCalledTimes(1)
    expect(browserProvider.load).toHaveBeenCalledTimes(1)
  })
})
