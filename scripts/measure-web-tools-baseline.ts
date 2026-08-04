import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createWebExtractTool } from '../src/server/tools/web-extract'
import { createWebFetchTool } from '../src/server/tools/web-fetch'
import { createWebScreenshotTool } from '../src/server/tools/web-screenshot'
import { WebBrowserError } from '../src/server/tools/web/browser-errors'
import { startWebToolsFixture } from './web-tools-fixture'

type TimingSummary = {
  samplesMs: number[]
  p50Ms: number
  p95Ms: number
  successCount: number
  failureCount: number
  errors: Record<string, number>
}

export type WebToolsBaselineResult = {
  fixtureOrigin: string
  sampleCount: number
  staticFetch: TimingSummary
  browserFetch: TimingSummary
  browserExtract: TimingSummary
  screenshot: TimingSummary & {
    artifactBytes: number[]
    artifactP50Bytes: number
    artifactP95Bytes: number
    artifactRelativePaths: string[]
  }
  concurrency: {
    requested: number
    maxConcurrency: number
    peakActiveContexts: number
    withinLimit: boolean
  }
  errorClassificationProbe: string
}

const SAMPLE_COUNT = 5
const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), 'docs/tools/agent-browser-baseline-v1.1.json')

export async function measureWebToolsBaseline(): Promise<WebToolsBaselineResult> {
  const fixture = await startWebToolsFixture({ maxConcurrency: 2, timeoutMs: 15_000 })
  const dataDir = process.env.BLOOMAI_T12_ARTIFACT_DIR
    ? path.resolve(process.env.BLOOMAI_T12_ARTIFACT_DIR)
    : await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bloomai-t12-baseline-'))

  try {
    const fetchTool = createWebFetchTool(fixture.loadPage)
    const extractTool = createWebExtractTool(fixture.loadPage)
    const context = (toolId: string, toolRunId?: string) => ({
      toolId,
      signal: new AbortController().signal,
      ...(toolRunId ? { toolRunId } : {}),
    })

    const staticFetch = await measure('static_fetch', SAMPLE_COUNT, async () => {
      await fetchTool({ url: fixture.urls.article, render: false }, context('web_fetch'))
    })
    const browserFetch = await measure('browser_fetch', SAMPLE_COUNT, async () => {
      await fetchTool({ url: fixture.urls.spa, render: true }, context('web_fetch'))
    })
    const browserExtract = await measure('browser_extract', SAMPLE_COUNT, async () => {
      await extractTool({ url: fixture.urls.spa, render: true }, context('web_extract'))
    })

    const artifactBytes: number[] = []
    const artifactRelativePaths: string[] = []
    const screenshotTool = createWebScreenshotTool({
      provider: fixture.browserProvider,
      dataDir,
      limits: { maxArtifactBytes: 10 * 1024 * 1024, retentionCount: 20 },
    })
    const screenshot = await measure('screenshot', 3, async (index) => {
      const result = await screenshotTool(
        {
          url: fixture.urls.browser,
          fullPage: false,
          viewport: { width: 1024, height: 768 },
          format: 'png',
        },
        context('web_screenshot', `t12-baseline-${index}`),
      )
      artifactBytes.push(result.bytes)
      artifactRelativePaths.push(result.relativePath)
    })

    const concurrencyRequested = fixture.browserProvider.maxContextConcurrency + 2
    await Promise.all(Array.from({ length: concurrencyRequested }, () => fixture.browserProvider.load({
      url: fixture.urls.slow,
      timeoutMs: 15_000,
      signal: new AbortController().signal,
    })))
    const peakActiveContexts = fixture.browserProvider.peakActiveContextCount
    if (peakActiveContexts > fixture.browserProvider.maxContextConcurrency) {
      throw new Error(`browser context peak ${peakActiveContexts} exceeded ${fixture.browserProvider.maxContextConcurrency}`)
    }
    let errorClassificationProbe = 'none'
    try {
      await fixture.browserProvider.load({
        url: `${fixture.origin}/blocked-resource.png`,
        timeoutMs: 15_000,
        signal: new AbortController().signal,
      })
    } catch (error) {
      errorClassificationProbe = classifyError(error)
    }

    return {
      fixtureOrigin: fixture.origin,
      sampleCount: SAMPLE_COUNT,
      staticFetch,
      browserFetch,
      browserExtract,
      screenshot: {
        ...screenshot,
        artifactBytes,
        artifactP50Bytes: percentile(artifactBytes, 0.5),
        artifactP95Bytes: percentile(artifactBytes, 0.95),
        artifactRelativePaths,
      },
      concurrency: {
        requested: concurrencyRequested,
        maxConcurrency: fixture.browserProvider.maxContextConcurrency,
        peakActiveContexts,
        withinLimit: peakActiveContexts <= fixture.browserProvider.maxContextConcurrency,
      },
      errorClassificationProbe,
    }
  } finally {
    await fixture.close()
  }
}

async function measure(
  name: string,
  count: number,
  operation: (index: number) => Promise<void>,
): Promise<TimingSummary> {
  const samplesMs: number[] = []
  const errors: Record<string, number> = {}
  let successCount = 0
  for (let index = 0; index < count; index += 1) {
    const startedAt = performance.now()
    try {
      await operation(index)
      successCount += 1
      samplesMs.push(Math.round(performance.now() - startedAt))
    } catch (error) {
      const code = classifyError(error)
      errors[code] = (errors[code] ?? 0) + 1
      process.stderr.write(`[baseline] ${name} sample ${index + 1} failed: ${code}\n`)
    }
  }
  if (successCount === 0) throw new Error(`${name} had no successful samples`)
  return {
    samplesMs,
    p50Ms: percentile(samplesMs, 0.5),
    p95Ms: percentile(samplesMs, 0.95),
    successCount,
    failureCount: count - successCount,
    errors,
  }
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1))
  return sorted[index]
}

function classifyError(error: unknown): string {
  if (error instanceof WebBrowserError) return error.code
  if (error instanceof Error && error.name === 'AbortError') return 'ABORT_ERR'
  return 'UNKNOWN_ERROR'
}

async function main(): Promise<void> {
  const result = await measureWebToolsBaseline()
  const serialized = `${JSON.stringify(result, null, 2)}\n`
  await fs.promises.writeFile(DEFAULT_OUTPUT_PATH, serialized, 'utf8')
  process.stdout.write(serialized)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
