import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { chromium, type Browser } from 'playwright-core'
import { AgentBrowserProvider } from '../src/server/tools/web/agent-browser-provider'
import { WebBrowserError } from '../src/server/tools/web/browser-errors'
import { getWebBrowserConfig, type WebBrowserConfig } from '../src/server/tools/web/config'
import type { WebLoadedPage, WebPageLoadRequest, WebPageProvider } from '../src/server/tools/web/contracts'
import { WebPageProviderRouter } from '../src/server/tools/web/provider-router'

const FIXTURE_ROOT = path.resolve(process.cwd(), 'src/server/tools/web/__fixtures__')

export type WebToolsFixture = {
  origin: string
  urls: {
    article: string
    spa: string
    browser: string
    slow: string
  }
  staticProvider: WebPageProvider
  browserProvider: AgentBrowserProvider
  router: WebPageProviderRouter
  loadPage: (url: string, request?: Omit<WebPageLoadRequest, 'url'>) => Promise<WebLoadedPage>
  getRequestCount: (pathname: string) => number
  getLaunchCount: () => number
  close: () => Promise<void>
}

export type WebToolsFixtureOptions = {
  maxConcurrency?: number
  timeoutMs?: number
}

export async function startWebToolsFixture(options: WebToolsFixtureOptions = {}): Promise<WebToolsFixture> {
  const article = `<!doctype html><html><head><title>Static fixture article</title></head><body><article><h1>Static fixture article</h1><p>${'A stable static page remains on the low-cost HTTP provider. '.repeat(12)}</p></article></body></html>`
  const browserArticle = fs.readFileSync(path.join(FIXTURE_ROOT, 'agent-browser-page.html'), 'utf8')
  const spa = fs.readFileSync(path.join(FIXTURE_ROOT, 'spa-page.html'), 'utf8')
  const requests = new Map<string, number>()
  const sockets = new Set<import('node:net').Socket>()
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
    requests.set(pathname, (requests.get(pathname) ?? 0) + 1)

    if (pathname === '/article.html' || pathname === '/agent-browser-page.html') {
      writeHtml(response, pathname === '/article.html' ? article : browserArticle)
      return
    }
    if (pathname === '/spa.html' || pathname === '/spa-page.html') {
      writeHtml(response, spa)
      return
    }
    if (pathname === '/slow.html') {
      setTimeout(() => writeHtml(response, '<html><body><main>slow fixture</main></body></html>'), 1_500)
      return
    }
    if (pathname === '/blocked-resource.png') {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(Buffer.from('resource should be blocked by the browser guard'))
      return
    }
    if (pathname === '/docs/getting-started') {
      writeHtml(response, '<html><body><h1>Getting started</h1></body></html>')
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server, sockets)
    throw new Error('web tools fixture server did not bind to loopback')
  }

  const origin = `http://127.0.0.1:${address.port}`
  const config = getWebBrowserConfig({
    ...process.env,
    WEB_BROWSER_ENABLED: 'true',
    WEB_BROWSER_MAX_CONCURRENCY: String(options.maxConcurrency ?? 2),
    WEB_BROWSER_IDLE_TIMEOUT_MS: '0',
    WEB_BROWSER_TIMEOUT_MS: String(options.timeoutMs ?? 15_000),
  })
  let launchCount = 0
  const browserProvider = new AgentBrowserProvider({
    config,
    launchBrowser: async (channels) => {
      launchCount += 1
      return launchFixtureBrowser(channels)
    },
    validateUrl: async (rawUrl) => validateFixtureUrl(rawUrl, origin),
  })

  const staticProvider: WebPageProvider = {
    id: 'static_http',
    async load(request) {
      const url = validateFixtureUrl(request.url, origin)
      const response = await fetch(url, { signal: request.signal, redirect: 'error' })
      if (!response.ok) throw new Error(`fixture static fetch failed with HTTP ${response.status}`)
      return {
        html: await response.text(),
        finalUrl: url.toString(),
        status: response.status,
        charset: 'utf-8',
        contentType: response.headers.get('content-type') ?? 'text/html; charset=utf-8',
        truncated: false,
        rendered: false,
        provider: 'static_http',
        diagnostics: { attempts: [] },
      }
    },
  }
  const router = new WebPageProviderRouter(staticProvider, browserProvider, {
    preference: 'auto',
    browserEnabled: true,
    allowSearchFallback: false,
  })

  return {
    origin,
    urls: {
      article: `${origin}/article.html`,
      spa: `${origin}/spa.html`,
      browser: `${origin}/agent-browser-page.html`,
      slow: `${origin}/slow.html`,
    },
    staticProvider,
    browserProvider,
    router,
    loadPage: (url, request) => router.loadPage({ url, ...request }),
    getRequestCount: (pathname) => requests.get(pathname) ?? 0,
    getLaunchCount: () => launchCount,
    close: async () => {
      await router.close().catch(() => {})
      await closeServer(server, sockets)
    },
  }
}

function writeHtml(response: http.ServerResponse, html: string): void {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(html)
}

async function closeServer(server: http.Server, sockets: Set<import('node:net').Socket>): Promise<void> {
  if (!server.listening) return
  for (const socket of sockets) socket.destroy()
  server.closeIdleConnections?.()
  server.closeAllConnections?.()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function launchFixtureBrowser(channels: readonly string[]): Promise<Browser> {
  let lastError: unknown
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel, headless: true })
    } catch (error) {
      lastError = error
    }
  }
  const executablePath = findBrowserExecutable()
  if (executablePath) return chromium.launch({ executablePath, headless: true })
  throw lastError instanceof Error ? lastError : new Error('no configured system browser could be launched')
}

function findBrowserExecutable(): string | undefined {
  const candidates = [
    process.env.BLOOMAI_WEB_BROWSER_EXECUTABLE_PATH,
    process.env.AGENT_BROWSER_EXECUTABLE_PATH,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : undefined,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : undefined,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find((candidate) => fs.existsSync(candidate))
}

function validateFixtureUrl(rawUrl: string, origin: string): URL {
  const url = new URL(rawUrl)
  if (url.origin !== origin) throw new WebBrowserError('WEB_URL_UNSAFE', 'fixture URL escaped the loopback origin')
  if (url.pathname === '/blocked-resource.png') {
    throw new WebBrowserError('WEB_URL_UNSAFE', 'fixture resource is intentionally blocked')
  }
  return url
}
