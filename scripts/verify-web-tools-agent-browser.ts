import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser } from 'playwright-core'
import { AgentBrowserProvider } from '../src/server/tools/web/agent-browser-provider'
import { WebBrowserError } from '../src/server/tools/web/browser-errors'
import { getWebBrowserConfig } from '../src/server/tools/web/config'
import { writeScreenshotArtifact } from '../src/server/tools/web/screenshot-artifacts'

export type AgentBrowserPocResult = {
  fixtureUrl: string
  hydrated: boolean
  screenshot: {
    path: string
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

    const loaded = await provider.load({ url: fixtureUrl, timeoutMs: config.timeoutMs })
    const hydrated = loaded.html.includes('Hydrated fixture') && loaded.html.includes('JavaScript ran inside')
    if (!hydrated) throw new Error('fixture did not hydrate in the browser')

    const screenshot = await provider.screenshot({
      url: fixtureUrl,
      fullPage: true,
      viewport: { width: 1024, height: 768 },
      format: 'png',
      timeoutMs: config.timeoutMs,
    })
    const artifact = await writeScreenshotArtifact({
      bytes: screenshot.bytes,
      mimeType: screenshot.mimeType,
      dataDir,
      runId: 'release-b2-poc',
      maxBytes: config.maxArtifactBytes,
    })
    if (screenshot.diagnostics.blockedRequests !== 1) {
      throw new Error(`expected one blocked subresource, got ${screenshot.diagnostics.blockedRequests ?? 0}`)
    }

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
      hydrated,
      screenshot: {
        path: artifact.imagePath,
        width: screenshot.width,
        height: screenshot.height,
        bytes: artifact.bytes,
      },
      blockedRequests: screenshot.diagnostics.blockedRequests ?? 0,
      abortCode,
      contextsAfterAbort,
      browserClosed,
    }
  } finally {
    await provider?.close().catch(() => {})
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function main(): Promise<void> {
  const result = await runAgentBrowserPoc()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
