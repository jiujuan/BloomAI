import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { AgentBrowser } from '@mastra/agent-browser'
import { chromium, type Browser } from 'playwright-core'
import { createWebExtractTool } from '../src/server/tools/web-extract'
import { createWebFetchTool } from '../src/server/tools/web-fetch'
import { createWebScreenshotTool } from '../src/server/tools/web-screenshot'
import { AgentBrowserProvider } from '../src/server/tools/web/agent-browser-provider'
import { WebBrowserError } from '../src/server/tools/web/browser-errors'
import { getWebBrowserConfig } from '../src/server/tools/web/config'
import { readScreenshotArtifact, writeScreenshotArtifact } from '../src/server/tools/web/screenshot-artifacts'
import { WebPageProviderRouter } from '../src/server/tools/web/provider-router'
import { startWebToolsFixture } from './web-tools-fixture'

export type AgentBrowserPocResult = {
  fixtureUrl: string
  agentBrowserApiUsed: boolean
  managerReadHydrated: boolean
  screenshotSource: 'agent_browser'
  hydrated: boolean
  screenshot: {
    relativePath: string
    width: number
    height: number
    bytes: number
  }
  blockedRequests: number
  abortCode: string
  contextsAfterAbort: number
  browserClosed: boolean
}

export async function runAgentBrowserPoc(): Promise<AgentBrowserPocResult> {
  const fixture = fs.readFileSync(path.resolve(process.cwd(), 'src/server/tools/web/__fixtures__/agent-browser-page.html'), 'utf8')
  const requests = new Map<string, number>()
  const sockets = new Set<import('node:net').Socket>()
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
    requests.set(pathname, (requests.get(pathname) || 0) + 1)
    if (pathname === '/agent-browser-page.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(fixture)
      return
    }
    if (pathname === '/slow.html') {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<html><body><main>slow fixture</main></body></html>')
      }, 1_500)
      return
    }
    if (pathname === '/blocked-resource.png') {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(Buffer.from('this request should be blocked'))
      return
    }
    response.writeHead(404)
    response.end('not found')
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })

  let browser: Browser | undefined
  let provider: AgentBrowserProvider | undefined
  const dataDir = process.env.BLOOMAI_B2_ARTIFACT_DIR
    ? path.resolve(process.env.BLOOMAI_B2_ARTIFACT_DIR)
    : path.join(os.tmpdir(), 'bloomai-release-b2-evidence')

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('fixture server did not bind to a TCP port')
    const origin = `http://127.0.0.1:${address.port}`
    const fixtureUrl = `${origin}/agent-browser-page.html`
    const slowUrl = `${origin}/slow.html`
    const validateUrl = async (rawUrl: string): Promise<URL> => {
      const url = new URL(rawUrl)
      if (url.origin === origin && (url.pathname === '/agent-browser-page.html' || url.pathname === '/slow.html')) return url
      throw new Error('unsafe external URL')
    }
    const config = {
      ...getWebBrowserConfig({ ...process.env, WEB_BROWSER_ENABLED: 'true' }),
      enabled: true,
      channels: process.env.WEB_BROWSER_CHANNELS?.split(',').map((value) => value.trim()).filter(Boolean) || ['msedge', 'chrome'],
    }
    const executablePath = findBrowserExecutable()
    const agentBrowser = new AgentBrowser({
      headless: true,
      timeout: config.timeoutMs,
      viewport: { width: 1024, height: 768 },
      scope: 'shared',
      ...(executablePath ? { executablePath } : {}),
    })
    let agentBrowserClosed = false
    try {
      await agentBrowser.ensureReady()
      const manager = await agentBrowser.getManagerForThread('release-b2-poc')
      const page = manager.getPage()
      let blockedRequests = 0
      await page.route('**/*', async (route) => {
        const requestUrl = route.request().url()
        if (requestUrl.endsWith('/blocked-resource.png')) {
          blockedRequests += 1
          await route.abort('blockedbyclient')
          return
        }
        await route.continue()
      })

      const navigation = await agentBrowser.goto({
        url: fixtureUrl,
        waitUntil: 'domcontentloaded',
        timeout: config.timeoutMs,
      }, 'release-b2-poc')
      assertAgentBrowserSuccess(navigation)
      const managerHtml = await page.content()
      const managerReadHydrated = managerHtml.includes('Hydrated fixture') && managerHtml.includes('JavaScript ran inside')
      if (!managerReadHydrated) throw new Error('AgentBrowser manager page did not hydrate the fixture')

      const screenshot = await agentBrowser.screenshot({ fullPage: false }, 'release-b2-poc')
      if (!('base64' in screenshot)) {
        throw new Error('message' in screenshot ? screenshot.message : 'AgentBrowser screenshot failed')
      }
      const screenshotBytes = Buffer.from(stripDataUrlPrefix(screenshot.base64), 'base64')
      const viewport = page.viewportSize() || { width: 1024, height: 768 }
      const artifact = await writeScreenshotArtifact({
        bytes: screenshotBytes,
        mimeType: 'image/png',
        dataDir,
        runId: 'release-b2-poc-agent-browser',
        maxBytes: config.maxArtifactBytes,
      })
      await agentBrowser.close()
      agentBrowserClosed = true

      const launchBrowser = async (channels: readonly string[]): Promise<Browser> => {
        let lastError: unknown
        for (const channel of channels) {
          try {
            browser = await chromium.launch({ channel, headless: true })
            return browser
          } catch (error) {
            lastError = error
          }
        }
        throw lastError instanceof Error ? lastError : new Error('no configured system browser could be launched')
      }
      provider = new AgentBrowserProvider({ config, launchBrowser, validateUrl })

      const controller = new AbortController()
      const abortPromise = provider.load({ url: slowUrl, timeoutMs: config.timeoutMs, signal: controller.signal })
      setTimeout(() => controller.abort(new Error('probe cancellation')), 75)
      let abortCode = 'none'
      try {
        await abortPromise
      } catch (error) {
        abortCode = error instanceof WebBrowserError ? error.code : 'unknown'
      }
      if (abortCode !== 'WEB_BROWSER_ABORTED') throw new Error(`abort mapped to ${abortCode}`)
      const contextsAfterAbort = browser?.contexts().length ?? -1
      if (contextsAfterAbort !== 0) throw new Error(`browser context leak after abort: ${contextsAfterAbort}`)

      await provider.close()
      const browserClosed = browser ? !browser.isConnected() : false
      return {
        fixtureUrl,
        agentBrowserApiUsed: true,
        managerReadHydrated,
        screenshotSource: 'agent_browser',
        hydrated: managerReadHydrated,
        screenshot: {
          relativePath: artifact.relativePath,
          width: viewport.width,
          height: viewport.height,
          bytes: artifact.bytes,
        },
        blockedRequests,
        abortCode,
        contextsAfterAbort,
        browserClosed: agentBrowserClosed && browserClosed,
      }
    } catch (error) {
      if (isAgentBrowserLaunchFailure(error)) {
        throw new WebBrowserError(
          'WEB_BROWSER_UNAVAILABLE',
          `AgentBrowser could not launch a configured browser: ${error instanceof Error ? error.message : String(error)}`,
          error,
        )
      }
      throw error
    } finally {
      if (!agentBrowserClosed) await agentBrowser.close().catch(() => {})
    }
  } finally {
    await provider?.close().catch(() => {})
    for (const socket of sockets) socket.destroy()
    server.closeIdleConnections?.()
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

export type WebToolsReleaseGateResult = {
  fixtureOrigin: string
  fetch: {
    staticProvider: string
    staticRendered: boolean
    browserProvider: string
    browserRendered: boolean
    browserContentIncludesHydration: boolean
  }
  extract: {
    staticProvider: string
    browserProvider: string
    browserTitle: string
    browserHeading: string
    browserLink: string
  }
  screenshot: {
    relativePath: string
    mimeType: string
    width: number
    height: number
    bytes: number
    pngSignature: boolean
    blockedRequests: number
  }
  abort: {
    code: string
    activeContextsAfterAbort: number
  }
  availability: {
    enabledAvailable: boolean
    enabledReason?: string
    disabledAvailable: boolean
    disabledReason?: string
    disabledScreenshotCode: string
  }
  rollback: {
    fetchProvider: string
    extractProvider: string
    browserLaunchesDuringRollback: number
  }
  browser: {
    launches: number
    peakActiveContexts: number
    maxConcurrency: number
  }
}

export async function runWebToolsReleaseGate(): Promise<WebToolsReleaseGateResult> {
  const fixture = await startWebToolsFixture({ maxConcurrency: 2, timeoutMs: 15_000 })
  const dataDir = process.env.BLOOMAI_T12_ARTIFACT_DIR
    ? path.resolve(process.env.BLOOMAI_T12_ARTIFACT_DIR)
    : await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bloomai-t12-artifacts-'))
  const context = (toolId: string, toolRunId?: string): {
    toolId: string
    signal: AbortSignal
    toolRunId?: string
  } => ({
    toolId,
    signal: new AbortController().signal,
    ...(toolRunId ? { toolRunId } : {}),
  })

  try {
    markReleaseGate('static fetch')
    const fetchTool = createWebFetchTool(fixture.loadPage)
    const extractTool = createWebExtractTool(fixture.loadPage)

    const staticFetch = await fetchTool(
      { url: fixture.urls.article, render: false },
      context('web_fetch'),
    )
    assert(staticFetch.provider === 'static_http', 'static web_fetch did not use static_http')
    assert(!staticFetch.rendered, 'static web_fetch unexpectedly rendered')
    assert(staticFetch.content.includes('Static fixture article'), 'static fixture content was not returned')
    assert(fixture.getLaunchCount() === 0, 'static web_fetch started a browser')

    markReleaseGate('browser fetch')
    const browserFetch = await fetchTool(
      { url: fixture.urls.spa, render: true },
      context('web_fetch'),
    )
    assert(browserFetch.provider === 'agent_browser', 'browser web_fetch did not use agent_browser')
    assert(browserFetch.rendered, 'browser web_fetch did not report rendered=true')
    assert(browserFetch.content.includes('Hydrated SPA article'), 'browser web_fetch missed hydrated content')

    markReleaseGate('static extract')
    const staticExtract = await extractTool(
      { url: fixture.urls.article, render: false },
      context('web_extract'),
    )
    assert(staticExtract.provider === 'static_http', 'static web_extract did not use static_http')
    assert(staticExtract.text.includes('Static fixture article'), 'static web_extract returned no readable text')

    markReleaseGate('browser extract')
    const browserExtract = await extractTool(
      { url: fixture.urls.spa, render: true, maxLinks: 1 },
      context('web_extract'),
    )
    assert(browserExtract.provider === 'agent_browser', 'browser web_extract did not use agent_browser')
    assert(browserExtract.title === 'SPA fixture', 'browser web_extract title mismatch')
    assert(browserExtract.headings.includes('Hydrated SPA article'), 'browser web_extract heading mismatch')
    assert(browserExtract.links[0]?.url.endsWith('/docs/getting-started') === true, 'browser web_extract link mismatch')

    markReleaseGate('screenshot')
    const screenshotTool = createWebScreenshotTool({
      provider: fixture.browserProvider,
      dataDir,
      limits: { maxArtifactBytes: 10 * 1024 * 1024, retentionCount: 20 },
    })
    const screenshot = await screenshotTool(
      {
        url: fixture.urls.browser,
        fullPage: false,
        viewport: { width: 1024, height: 768 },
        format: 'png',
      },
      context('web_screenshot', 't12-release-gate'),
    )
    const screenshotContent = await readScreenshotArtifact({
      dataDir,
      runId: screenshot.runId,
      relativePath: screenshot.relativePath,
    })
    assert(/^tool-artifacts\/web-screenshot\/[A-Za-z0-9._-]+\/screenshot\.png$/.test(screenshot.relativePath), 'screenshot path is not controlled')
    assert(screenshotContent.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'screenshot is not a PNG')
    assert(screenshotContent.bytesCount === screenshot.bytes, 'screenshot byte metadata mismatch')
    assert((screenshot.diagnostics.blockedRequests ?? 0) >= 1, 'browser request guard did not block the fixture resource')

    markReleaseGate('abort')
    const abortController = new AbortController()
    const abortPromise = fixture.browserProvider.load({
      url: fixture.urls.slow,
      timeoutMs: 15_000,
      signal: abortController.signal,
    })
    setTimeout(() => abortController.abort(new Error('release gate cancellation')), 75)
    let abortCode = 'none'
    try {
      await abortPromise
    } catch (error) {
      abortCode = error instanceof WebBrowserError ? error.code : 'unknown'
    }
    assert(abortCode === 'WEB_BROWSER_ABORTED', `abort mapped to ${abortCode}`)
    assert(fixture.browserProvider.activeContextCount === 0, 'browser context remained active after abort')

    markReleaseGate('availability')
    const enabledAvailability = await fixture.browserProvider.checkAvailability?.()
    assert(enabledAvailability?.available === true, `enabled browser availability failed: ${enabledAvailability?.reason ?? 'unknown'}`)

    const disabledConfig = getWebBrowserConfig({ ...process.env, WEB_BROWSER_ENABLED: 'false' })
    const disabledProvider = new AgentBrowserProvider({
      config: disabledConfig,
      launchBrowser: async () => { throw new Error('disabled provider must not launch') },
      validateUrl: async (url) => new URL(url),
    })
    const disabledAvailability = await disabledProvider.checkAvailability()
    assert(!disabledAvailability.available, 'disabled browser provider reported available')
    const disabledScreenshotTool = createWebScreenshotTool({
      provider: disabledProvider,
      dataDir,
    })
    let disabledScreenshotCode = 'none'
    try {
      await disabledScreenshotTool(
        { url: fixture.urls.browser, viewport: { width: 1024, height: 768 }, format: 'png' },
        context('web_screenshot', 't12-disabled-screenshot'),
      )
    } catch (error) {
      disabledScreenshotCode = error instanceof WebBrowserError ? error.code : 'unknown'
    }
    assert(disabledScreenshotCode === 'WEB_BROWSER_DISABLED', `disabled screenshot mapped to ${disabledScreenshotCode}`)

    markReleaseGate('rollback')
    const rollbackRouter = new WebPageProviderRouter(fixture.staticProvider, disabledProvider, {
      preference: 'auto',
      browserEnabled: false,
      allowSearchFallback: false,
    })
    const rollbackFetchTool = createWebFetchTool((url, request) => rollbackRouter.loadPage({ url, ...request }))
    const rollbackExtractTool = createWebExtractTool((url, request) => rollbackRouter.loadPage({ url, ...request }))
    const rollbackFetch = await rollbackFetchTool(
      { url: fixture.urls.article, render: false },
      context('web_fetch'),
    )
    const rollbackExtract = await rollbackExtractTool(
      { url: fixture.urls.article, render: false },
      context('web_extract'),
    )
    assert(rollbackFetch.provider === 'static_http', 'static web_fetch did not survive browser rollback')
    assert(rollbackExtract.provider === 'static_http', 'static web_extract did not survive browser rollback')
    assert(fixture.getLaunchCount() === 1, 'browser launch count changed during disabled rollback')
    await disabledProvider.close()

    markReleaseGate('complete')
    return {
      fixtureOrigin: fixture.origin,
      fetch: {
        staticProvider: staticFetch.provider,
        staticRendered: staticFetch.rendered,
        browserProvider: browserFetch.provider,
        browserRendered: browserFetch.rendered,
        browserContentIncludesHydration: browserFetch.content.includes('Hydrated SPA article'),
      },
      extract: {
        staticProvider: staticExtract.provider,
        browserProvider: browserExtract.provider,
        browserTitle: browserExtract.title,
        browserHeading: browserExtract.headings[0] ?? '',
        browserLink: browserExtract.links[0]?.url ?? '',
      },
      screenshot: {
        relativePath: screenshot.relativePath,
        mimeType: screenshot.mimeType,
        width: screenshot.width,
        height: screenshot.height,
        bytes: screenshot.bytes,
        pngSignature: true,
        blockedRequests: screenshot.diagnostics.blockedRequests ?? 0,
      },
      abort: {
        code: abortCode,
        activeContextsAfterAbort: fixture.browserProvider.activeContextCount,
      },
      availability: {
        enabledAvailable: enabledAvailability?.available === true,
        ...(enabledAvailability?.reason ? { enabledReason: enabledAvailability.reason } : {}),
        disabledAvailable: disabledAvailability.available,
        ...(disabledAvailability.reason ? { disabledReason: disabledAvailability.reason } : {}),
        disabledScreenshotCode,
      },
      rollback: {
        fetchProvider: rollbackFetch.provider,
        extractProvider: rollbackExtract.provider,
        browserLaunchesDuringRollback: fixture.getLaunchCount() - 1,
      },
      browser: {
        launches: fixture.getLaunchCount(),
        peakActiveContexts: fixture.browserProvider.peakActiveContextCount,
        maxConcurrency: fixture.browserProvider.maxContextConcurrency,
      },
    }
  } finally {
    await fixture.close()
  }
}

function markReleaseGate(stage: string): void {
  process.stderr.write(`[release-gate] ${stage}\n`)
}

function assertAgentBrowserSuccess<T extends { success: true }>(result: T | { success: false; message?: string }): asserts result is T {
  if ('success' in result && result.success === false) throw new Error(result.message || 'AgentBrowser operation failed')
}

function stripDataUrlPrefix(value: string): string {
  return value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
}

function findBrowserExecutable(): string | undefined {
  const candidates = [
    process.env.BLOOMAI_WEB_BROWSER_EXECUTABLE_PATH,
    process.env.AGENT_BROWSER_EXECUTABLE_PATH,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : undefined,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find((candidate) => fs.existsSync(candidate))
}

function isAgentBrowserLaunchFailure(error: unknown): boolean {
  if (error instanceof WebBrowserError) return error.code === 'WEB_BROWSER_UNAVAILABLE'
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('executable doesn\'t exist')
    || message.includes('browser was not found')
    || message.includes('failed to launch')
    || message.includes('could not find')
}

async function main(): Promise<void> {
  const poc = await runAgentBrowserPoc()
  const releaseGate = await runWebToolsReleaseGate()
  process.stdout.write(`${JSON.stringify({ poc, releaseGate }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
