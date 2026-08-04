import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { AgentBrowser } from '@mastra/agent-browser'
import { chromium, type Browser } from 'playwright-core'
import { AgentBrowserProvider } from '../src/server/tools/web/agent-browser-provider'
import { WebBrowserError } from '../src/server/tools/web/browser-errors'
import { getWebBrowserConfig } from '../src/server/tools/web/config'
import { writeScreenshotArtifact } from '../src/server/tools/web/screenshot-artifacts'

export type AgentBrowserPocResult = {
  fixtureUrl: string
  agentBrowserApiUsed: boolean
  managerReadHydrated: boolean
  screenshotSource: 'agent_browser'
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
    const executablePath = findBrowserExecutable()
    const agentBrowser = new AgentBrowser({
      headless: true,
      timeout: config.timeoutMs,
      viewport: { width: 1024, height: 768 },
      ...(executablePath ? { executablePath } : {}),
    })
    let agentBrowserClosed = false
    try {
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
          path: artifact.imagePath,
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
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
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
  const result = await runAgentBrowserPoc()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
