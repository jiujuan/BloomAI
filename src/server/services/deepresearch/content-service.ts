import crypto from 'crypto'
import type { JsonObject, ResearchRunDto, ResearchSourceDto, ResearchSourceSnapshotDto } from '@shared/deepresearch/contracts'
import { researchEventRepo } from '@server/db/repositories/deepresearch/research-event.repo'
import { executeLegacyToolCapability } from '@server/skills/policy/capability-broker'
import { researchSourceRepo } from '@server/db/repositories/deepresearch/research-source.repo'
import { createSnapshotFingerprint } from '@server/deepresearch/domain/idempotency'
import {
  SOURCE_CONTENT_PARSER_VERSION,
  classifySourceFetchFailure,
  extractMainContent,
  type SourceContentDiagnostics,
  type SourceContentRejectionReason,
} from '@server/deepresearch/domain/source-content'
import type { WorkflowToolExecutor } from './search-service'
import { isCancellationRequested, throwIfCancellationRequested, type ResearchCancellationSignal } from '@server/deepresearch/domain/cancellation'
import { parseExternalUrl, validateInitialUrl } from '@server/tools/web/url-policy'
import { createBrowserRetryBudget, shouldRetryWithBrowser, type BrowserRetryReason } from './browser-retry-policy'
import type { WebProviderId } from '@server/tools/web/contracts'

export interface FetchOutcome {
  sourceId: string
  status: 'fetched' | 'failed'
  snapshot: ResearchSourceSnapshotDto | null
  error: { code: string; message: string; retryable: boolean } | null
  provider: WebProviderId | null
  retryReason: BrowserRetryReason | null
  browserRetryAttempted: boolean
  browserRetryUsed: boolean
  browserRetryErrorCode: string | null
}

export type ResearchHostLookup = (hostname: string) => Promise<string[]>

type FetchToolOutput = {
  finalUrl?: unknown
  status?: unknown
  content?: unknown
  provider?: unknown
  rendered?: unknown
}

type ExtractToolOutput = {
  finalUrl?: unknown
  text?: unknown
  title?: unknown
  headings?: unknown
  byline?: unknown
  author?: unknown
  publishedAt?: unknown
  canonicalUrl?: unknown
  rendered?: unknown
  provider?: unknown
}

type FetchMetadata = {
  provider: WebProviderId | null
  retryReason: BrowserRetryReason | null
  browserRetryAttempted: boolean
  browserRetryUsed: boolean
  browserRetryErrorCode: string | null
}

class ContentRejectedError extends Error {
  constructor(
    readonly reason: SourceContentRejectionReason,
    readonly diagnostics: SourceContentDiagnostics | JsonObject,
    message = `Source content rejected: ${reason}.`,
  ) {
    super(message)
    this.name = 'ContentRejectedError'
  }
}

function contentRejectionCode(reason: SourceContentRejectionReason): string {
  return `RESEARCH_CONTENT_${reason.toUpperCase()}`
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(?:$|[?#])/i.test(url)
}

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /timeout|timed out|rate.?limit|\b429\b|provider unavailable|\b503\b|temporar/i.test(message)
}

function asWebProviderId(value: unknown): WebProviderId | null {
  return value === 'static_http' || value === 'playwright_legacy' || value === 'agent_browser'
    ? value
    : null
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('WEB_')) return message.split(':', 1)[0]
  if (/deadline/i.test(message)) return 'RESEARCH_DEADLINE_EXHAUSTED'
  return 'RESEARCH_BROWSER_RETRY_FAILED'
}

function defaultFetchMetadata(): FetchMetadata {
  return {
    provider: null,
    retryReason: null,
    browserRetryAttempted: false,
    browserRetryUsed: false,
    browserRetryErrorCode: null,
  }
}

export function assertSafeResearchUrl(value: string): URL {
  try {
    return parseExternalUrl(value)
  } catch {
    throw new Error('RESEARCH_UNSAFE_URL: URL must be valid.')
  }
}

async function validatePublicResearchUrl(value: string, lookup?: ResearchHostLookup): Promise<string> {
  try {
    return (await validateInitialUrl(value, { lookup })).toString()
  } catch (error) {
    const detail = error instanceof Error
      ? error.message.replace(/^unsafe external URL:\s*/i, '')
      : 'URL could not be validated safely.'
    throw new Error(`RESEARCH_UNSAFE_URL: ${detail}`)
  }
}

function sanitizeContent(value: string): string {
  return value
    .replace(/^(authorization|cookie|set-cookie):.*$/gim, '[redacted header]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/g, 'Bearer [redacted]')
    .replace(/\b[A-Za-z]:\\[^\r\n]*/g, '[redacted local path]')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function retryWithinDeadline<T>(
  operation: () => Promise<T>,
  deadlineAt: number | null,
  sleep: (ms: number) => Promise<void>,
  cancellation: ResearchCancellationSignal = {},
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    throwIfCancellationRequested(cancellation)
    if (deadlineAt !== null && Date.now() >= deadlineAt) break
    try {
      const value = await operation()
      throwIfCancellationRequested(cancellation)
      return value
    } catch (error) {
      lastError = error
      if (!isRetryableError(error) || attempt === 2) throw error
      const delay = 100 * 2 ** attempt
      if (deadlineAt !== null && Date.now() + delay >= deadlineAt) break
      throwIfCancellationRequested(cancellation)
      await sleep(delay)
      throwIfCancellationRequested(cancellation)
    }
  }
  throw lastError ?? new Error('Deep Research fetch deadline exhausted.')
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  map: (item: T) => Promise<R>,
  isCancelled: () => boolean,
  onCancelled: (item: T) => R,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = isCancelled() ? onCancelled(items[index]) : await map(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker))
  return results
}

export function createContentService(options: {
  repositories?: { researchSourceRepo: typeof researchSourceRepo; researchEventRepo: typeof researchEventRepo }
  executeTool?: WorkflowToolExecutor
  maxConcurrency?: number
  sleep?: (ms: number) => Promise<void>
  lookup?: ResearchHostLookup
  isCancelled?: (runId: string) => boolean
} = {}) {
  const repositories = options.repositories ?? { researchSourceRepo, researchEventRepo }
  const executeTool: WorkflowToolExecutor = options.executeTool ?? executeLegacyToolCapability
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const lookup = options.lookup
  const isCancelled = options.isCancelled ?? (() => false)

  function failureOutcome(
    run: ResearchRunDto,
    source: ResearchSourceDto,
    error: { code: string; message: string; retryable: boolean },
    diagnostics?: SourceContentDiagnostics | JsonObject,
    rejectionReason?: SourceContentRejectionReason,
    finalUrl?: string,
    fetchMetadata: FetchMetadata = defaultFetchMetadata(),
  ): FetchOutcome {
    if (error.code !== 'RESEARCH_CANCELLED') {
      repositories.researchEventRepo.append({
        runId: run.id,
        type: 'research.source.fetch_failed',
        phase: 'fetching',
        payload: {
          sourceId: source.id,
          provider: fetchMetadata.provider,
          retryReason: fetchMetadata.retryReason,
          browserRetryAttempted: fetchMetadata.browserRetryAttempted,
          browserRetryUsed: fetchMetadata.browserRetryUsed,
          browserRetryErrorCode: fetchMetadata.browserRetryErrorCode,
          errorCode: error.code,
          rejectionReason: rejectionReason ?? null,
          finalUrl: finalUrl ?? null,
          contentDiagnostics: diagnostics ? { ...diagnostics } : null,
        },
      })
    }
    repositories.researchEventRepo.append({
      runId: run.id,
      type: 'research.source.fetch_diagnostics',
      phase: 'fetching',
      payload: {
        sourceId: source.id,
        provider: fetchMetadata.provider,
        retryReason: fetchMetadata.retryReason,
        browserRetryAttempted: fetchMetadata.browserRetryAttempted,
        browserRetryUsed: fetchMetadata.browserRetryUsed,
        browserRetryErrorCode: fetchMetadata.browserRetryErrorCode,
      },
    })
    return { sourceId: source.id, status: 'failed', snapshot: null, error, ...fetchMetadata }
  }

  async function fetchOne(
    run: ResearchRunDto,
    source: ResearchSourceDto,
    browserRetryBudget: ReturnType<typeof createBrowserRetryBudget>,
    signal?: AbortSignal,
    cancelled: () => boolean = () => isCancelled(run.id),
  ): Promise<FetchOutcome> {
    throwIfCancellationRequested({ signal, isCancellationRequested: cancelled })
    if (cancelled()) return failureOutcome(run, source, { code: 'RESEARCH_CANCELLED', message: 'Deep Research run was cancelled.', retryable: false })
    const existingSnapshot = repositories.researchSourceRepo.getLatestSnapshotForSource(run.id, source.id)
    if (existingSnapshot) {
      return {
        sourceId: source.id,
        status: 'fetched',
        snapshot: existingSnapshot,
        error: null,
        ...defaultFetchMetadata(),
      }
    }

    let fetchMetadata = defaultFetchMetadata()
    let failureFinalUrl = source.canonicalUrl
    try {
      const initialUrl = await validatePublicResearchUrl(source.canonicalUrl, lookup)
      if (isPdfUrl(initialUrl)) {
        throw new ContentRejectedError('unsupported_pdf', {
          parser: SOURCE_CONTENT_PARSER_VERSION,
          finalUrl: initialUrl,
          rejectionReasons: ['unsupported_pdf'],
        })
      }

      let fetched = await retryWithinDeadline(
        () => executeTool({
          caller: 'workflow',
          toolId: 'web_fetch',
          input: { url: initialUrl, render: false, maxChars: 50_000 },
          sessionId: run.sessionId ?? run.id,
          signal,
        }),
        run.usage.deadlineAt,
        sleep,
        { signal, isCancellationRequested: cancelled },
      )
      throwIfCancellationRequested({ signal, isCancellationRequested: cancelled })
      let fetchOutput = fetched.output as FetchToolOutput
      const fetchedFinalUrl = typeof fetchOutput.finalUrl === 'string' ? fetchOutput.finalUrl : initialUrl
      const safeFetchedFinalUrl = await validatePublicResearchUrl(fetchedFinalUrl, lookup)
      if (cancelled()) return failureOutcome(run, source, { code: 'RESEARCH_CANCELLED', message: 'Deep Research run was cancelled.', retryable: false })

      let extracted = await retryWithinDeadline(
        () => executeTool({
          caller: 'workflow',
          toolId: 'web_extract',
          input: { url: safeFetchedFinalUrl, render: false, maxChars: 50_000 },
          sessionId: run.sessionId ?? run.id,
          signal,
        }),
        run.usage.deadlineAt,
        sleep,
        { signal, isCancellationRequested: cancelled },
      )
      throwIfCancellationRequested({ signal, isCancellationRequested: cancelled })
      let extractOutput = extracted.output as ExtractToolOutput
      let finalUrl = await validatePublicResearchUrl(
        typeof extractOutput.finalUrl === 'string' ? extractOutput.finalUrl : safeFetchedFinalUrl,
        lookup,
      )
      failureFinalUrl = finalUrl
      if (isPdfUrl(finalUrl)) {
        throw new ContentRejectedError('unsupported_pdf', {
          parser: SOURCE_CONTENT_PARSER_VERSION,
          finalUrl,
          rejectionReasons: ['unsupported_pdf'],
        })
      }

      let rawContent = typeof extractOutput.text === 'string' && extractOutput.text.trim()
        ? extractOutput.text
        : typeof fetchOutput.content === 'string' ? fetchOutput.content : ''
      const staticExtraction = extractMainContent({
        text: sanitizeContent(rawContent),
        finalUrl,
        title: sanitizeContent(typeof extractOutput.title === 'string' ? extractOutput.title : source.title ?? ''),
        byline: sanitizeContent(typeof extractOutput.byline === 'string'
          ? extractOutput.byline
          : typeof extractOutput.author === 'string' ? extractOutput.author : source.author ?? ''),
        publishedAt: typeof extractOutput.publishedAt === 'string' || typeof extractOutput.publishedAt === 'number'
          ? extractOutput.publishedAt
          : source.publishedAt,
        canonicalUrl: typeof extractOutput.canonicalUrl === 'string'
          ? await validatePublicResearchUrl(extractOutput.canonicalUrl, lookup)
          : finalUrl,
        rendered: typeof extractOutput.rendered === 'boolean' ? extractOutput.rendered : false,
      })
      const retryDecision = shouldRetryWithBrowser(staticExtraction.diagnostics)
      fetchMetadata = {
        ...fetchMetadata,
        provider: asWebProviderId(extractOutput.provider) ?? asWebProviderId(fetchOutput.provider) ?? 'static_http',
        retryReason: retryDecision.reason,
      }
      throwIfCancellationRequested({ signal, isCancellationRequested: cancelled })

      const reservation = retryDecision.reason
        ? browserRetryBudget.tryReserve(source.id, retryDecision.reason)
        : null
      if (reservation) {
        try {
          await browserRetryBudget.run(reservation, signal, run.usage.deadlineAt, async () => {
            throwIfCancellationRequested({ signal, isCancellationRequested: cancelled })
            fetchMetadata = { ...fetchMetadata, browserRetryAttempted: true }
            const browserFetched = await retryWithinDeadline(
              () => executeTool({
                caller: 'workflow',
                toolId: 'web_fetch',
                input: { url: initialUrl, render: true, maxChars: 50_000 },
                sessionId: run.sessionId ?? run.id,
                signal,
              }),
              run.usage.deadlineAt,
              sleep,
              { signal, isCancellationRequested: cancelled },
            )
            const browserFetchOutput = browserFetched.output as FetchToolOutput
            const browserFetchedFinalUrl = typeof browserFetchOutput.finalUrl === 'string'
              ? browserFetchOutput.finalUrl
              : initialUrl
            const safeBrowserFetchedFinalUrl = await validatePublicResearchUrl(browserFetchedFinalUrl, lookup)
            const browserExtracted = await retryWithinDeadline(
              () => executeTool({
                caller: 'workflow',
                toolId: 'web_extract',
                input: { url: safeBrowserFetchedFinalUrl, render: true, maxChars: 50_000 },
                sessionId: run.sessionId ?? run.id,
                signal,
              }),
              run.usage.deadlineAt,
              sleep,
              { signal, isCancellationRequested: cancelled },
            )
            const browserExtractOutput = browserExtracted.output as ExtractToolOutput
            const browserFinalUrl = await validatePublicResearchUrl(
              typeof browserExtractOutput.finalUrl === 'string'
                ? browserExtractOutput.finalUrl
                : safeBrowserFetchedFinalUrl,
              lookup,
            )
            const browserCandidate = extractMainContent({
              text: sanitizeContent(typeof browserExtractOutput.text === 'string' && browserExtractOutput.text.trim()
                ? browserExtractOutput.text
                : typeof browserFetchOutput.content === 'string' ? browserFetchOutput.content : ''),
              finalUrl: browserFinalUrl,
              title: sanitizeContent(typeof browserExtractOutput.title === 'string'
                ? browserExtractOutput.title
                : source.title ?? ''),
              byline: sanitizeContent(typeof browserExtractOutput.byline === 'string'
                ? browserExtractOutput.byline
                : typeof browserExtractOutput.author === 'string' ? browserExtractOutput.author : source.author ?? ''),
              publishedAt: typeof browserExtractOutput.publishedAt === 'string' || typeof browserExtractOutput.publishedAt === 'number'
                ? browserExtractOutput.publishedAt
                : source.publishedAt,
              canonicalUrl: typeof browserExtractOutput.canonicalUrl === 'string'
                ? await validatePublicResearchUrl(browserExtractOutput.canonicalUrl, lookup)
                : browserFinalUrl,
              rendered: typeof browserExtractOutput.rendered === 'boolean' ? browserExtractOutput.rendered : true,
            })
            if (browserCandidate.rejectionReasons.length > 0 || browserCandidate.content.length <= staticExtraction.content.length) return

            fetched = browserFetched
            extracted = browserExtracted
            fetchOutput = browserFetchOutput
            extractOutput = browserExtractOutput
            finalUrl = browserFinalUrl
            failureFinalUrl = browserFinalUrl
            rawContent = typeof browserExtractOutput.text === 'string' && browserExtractOutput.text.trim()
              ? browserExtractOutput.text
              : typeof browserFetchOutput.content === 'string' ? browserFetchOutput.content : ''
            fetchMetadata = {
              ...fetchMetadata,
              provider: asWebProviderId(browserExtractOutput.provider)
                ?? asWebProviderId(browserFetchOutput.provider)
                ?? 'agent_browser',
              browserRetryUsed: true,
              browserRetryErrorCode: null,
            }
          })
        } catch (error) {
          if (isCancellationRequested({ signal, isCancellationRequested: cancelled })) throw error
          fetchMetadata = { ...fetchMetadata, browserRetryErrorCode: errorCode(error) }
        }
      }

      const metadataCanonicalUrl = typeof extractOutput.canonicalUrl === 'string'
        ? await validatePublicResearchUrl(extractOutput.canonicalUrl, lookup)
        : finalUrl
      if (!rawContent) throw new Error('RESEARCH_FETCH_FAILED: no readable source content was returned.')
      const extraction = extractMainContent({
        text: sanitizeContent(rawContent),
        finalUrl,
        title: sanitizeContent(typeof extractOutput.title === 'string' ? extractOutput.title : source.title ?? ''),
        byline: sanitizeContent(typeof extractOutput.byline === 'string'
          ? extractOutput.byline
          : typeof extractOutput.author === 'string' ? extractOutput.author : source.author ?? ''),
        publishedAt: typeof extractOutput.publishedAt === 'string' || typeof extractOutput.publishedAt === 'number'
          ? extractOutput.publishedAt
          : source.publishedAt,
        canonicalUrl: metadataCanonicalUrl,
        rendered: typeof extractOutput.rendered === 'boolean' ? extractOutput.rendered : null,
      })
      if (extraction.rejectionReasons.length > 0) {
        throw new ContentRejectedError(extraction.rejectionReasons[0], extraction.diagnostics)
      }

      const content = extraction.content
      const contentHash = crypto.createHash('sha256').update(content).digest('hex')
      throwIfCancellationRequested({ signal, isCancellationRequested: cancelled })
      const provider = fetchMetadata.provider
        ?? asWebProviderId(extractOutput.provider)
        ?? asWebProviderId(fetchOutput.provider)
        ?? 'static_http'
      fetchMetadata = { ...fetchMetadata, provider }
      const snapshot = repositories.researchSourceRepo.createSnapshot({
        runId: run.id,
        sourceId: source.id,
        contentHash,
        content,
        metadata: {
          ...extraction.metadata,
          headings: Array.isArray(extractOutput.headings)
            ? extractOutput.headings.filter((heading): heading is string => typeof heading === 'string').slice(0, 40)
            : [],
          fetch: {
            rendered: typeof extractOutput.rendered === 'boolean' ? extractOutput.rendered : null,
            httpStatus: typeof fetchOutput.status === 'number' ? fetchOutput.status : null,
            provider,
            retryReason: fetchMetadata.retryReason,
            browserRetryAttempted: fetchMetadata.browserRetryAttempted,
            browserRetryUsed: fetchMetadata.browserRetryUsed,
            browserRetryErrorCode: fetchMetadata.browserRetryErrorCode,
          },
        },
        fetchedAt: Date.now(),
        parserVersion: SOURCE_CONTENT_PARSER_VERSION,
        finalUrl,
        httpStatus: typeof fetchOutput.status === 'number' ? fetchOutput.status : null,
        idempotencyKey: createSnapshotFingerprint({
          runId: run.id,
          sourceId: source.id,
          finalUrl,
          parserVersion: SOURCE_CONTENT_PARSER_VERSION,
          contentHash,
        }),
      })
      repositories.researchEventRepo.append({
        runId: run.id,
        type: 'research.source.fetch_diagnostics',
        phase: 'fetching',
        payload: {
          sourceId: source.id,
          provider,
          retryReason: fetchMetadata.retryReason,
          browserRetryAttempted: fetchMetadata.browserRetryAttempted,
          browserRetryUsed: fetchMetadata.browserRetryUsed,
          browserRetryErrorCode: fetchMetadata.browserRetryErrorCode,
        },
      })
      return { sourceId: source.id, status: 'fetched', snapshot, error: null, ...fetchMetadata }
    } catch (error) {
      if (isCancellationRequested({ signal, isCancellationRequested: cancelled })) {
        return failureOutcome(
          run,
          source,
          { code: 'RESEARCH_CANCELLED', message: 'Deep Research run was cancelled.', retryable: false },
          undefined,
          undefined,
          failureFinalUrl,
          fetchMetadata,
        )
      }
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof ContentRejectedError) {
        return failureOutcome(run, source, {
          code: contentRejectionCode(error.reason),
          message,
          retryable: false,
        }, error.diagnostics, error.reason, failureFinalUrl, fetchMetadata)
      }
      const rejectionReason = classifySourceFetchFailure(message, failureFinalUrl)
      if (rejectionReason) {
        return failureOutcome(run, source, {
          code: contentRejectionCode(rejectionReason),
          message,
          retryable: false,
        }, { parser: SOURCE_CONTENT_PARSER_VERSION, rejectionReasons: [rejectionReason] }, rejectionReason, failureFinalUrl, fetchMetadata)
      }
      return failureOutcome(
        run,
        source,
        {
          code: message.startsWith('RESEARCH_UNSAFE_URL') ? 'RESEARCH_UNSAFE_URL' : 'RESEARCH_FETCH_FAILED',
          message,
          retryable: isRetryableError(error),
        },
        undefined,
        undefined,
        failureFinalUrl,
        fetchMetadata,
      )
    }
  }

  return {
    fetch(run: ResearchRunDto, sources: ResearchSourceDto[], requestOptions: { signal?: AbortSignal; isCancelled?: () => boolean } = {}): Promise<FetchOutcome[]> {
      const limited = sources.slice(0, Math.max(0, run.budget.maxFetchedSources - run.usage.fetchedSources))
      const maxBrowserFetches = Math.max(0, (run.budget.maxBrowserFetches ?? 0) - (run.usage.browserFetches ?? 0))
      const browserRetryBudget = createBrowserRetryBudget({
        maxBrowserFetches,
        browserFetchConcurrency: run.budget.browserFetchConcurrency ?? 1,
      })
      const cancelled = () => isCancellationRequested({
        signal: requestOptions.signal,
        isCancellationRequested: requestOptions.isCancelled ?? (() => isCancelled(run.id)),
      })
      throwIfCancellationRequested({ signal: requestOptions.signal, isCancellationRequested: cancelled })
      return mapWithConcurrency(
        limited,
        options.maxConcurrency ?? run.budget.fetchConcurrency,
        (source) => fetchOne(run, source, browserRetryBudget, requestOptions.signal, cancelled),
        cancelled,
        (source) => failureOutcome(run, source, { code: 'RESEARCH_CANCELLED', message: 'Deep Research run was cancelled.', retryable: false }),
      )
    },
  }
}
