import crypto from 'crypto'
import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import type { ResearchRunDto, ResearchSourceDto, ResearchSourceSnapshotDto } from '@shared/deepresearch/contracts'
import { researchEventRepo } from '@server/db/repositories/deepresearch/research-event.repo'
import { executeLegacyToolCapability } from '@server/skills/policy/capability-broker'
import { researchSourceRepo } from '@server/db/repositories/deepresearch/research-source.repo'
import { createSnapshotFingerprint } from '@server/deepresearch/domain/idempotency'
import type { WorkflowToolExecutor } from './search-service'

export interface FetchOutcome {
  sourceId: string
  status: 'fetched' | 'failed'
  snapshot: ResearchSourceSnapshotDto | null
  error: { code: string; message: string; retryable: boolean } | null
}

export type ResearchHostLookup = (hostname: string) => Promise<string[]>

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /timeout|timed out|rate.?limit|\b429\b|provider unavailable|\b503\b|temporar/i.test(message)
}

function isPublicAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) {
    const [a, b] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19)) || a >= 224)
  }
  if (version === 6) {
    const lower = address.toLowerCase()
    if (lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || /^fe[89ab]/.test(lower) || lower.startsWith('ff')) return false
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    return !mapped || isPublicAddress(mapped[1])
  }
  return false
}

export function assertSafeResearchUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('RESEARCH_UNSAFE_URL: URL must be valid.')
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) throw new Error('RESEARCH_UNSAFE_URL: only credential-free HTTP(S) URLs are allowed.')
  if (host === 'localhost' || host.endsWith('.localhost') || (isIP(host) !== 0 && !isPublicAddress(host))) {
    throw new Error('RESEARCH_UNSAFE_URL: private or local network targets are not allowed.')
  }
  return url
}

async function assertPublicResearchHost(url: URL, lookup: ResearchHostLookup): Promise<void> {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (isIP(hostname)) return
  let addresses: string[]
  try {
    addresses = await lookup(hostname)
  } catch {
    throw new Error('RESEARCH_UNSAFE_URL: source host could not be resolved safely.')
  }
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error('RESEARCH_UNSAFE_URL: private or local network targets are not allowed.')
  }
}

async function validatePublicResearchUrl(value: string, lookup: ResearchHostLookup): Promise<string> {
  const url = assertSafeResearchUrl(value)
  await assertPublicResearchHost(url, lookup)
  return url.toString()
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

async function retryWithinDeadline<T>(operation: () => Promise<T>, deadlineAt: number | null, sleep: (ms: number) => Promise<void>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (deadlineAt !== null && Date.now() >= deadlineAt) break
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isRetryableError(error) || attempt === 2) throw error
      const delay = 100 * 2 ** attempt
      if (deadlineAt !== null && Date.now() + delay >= deadlineAt) break
      await sleep(delay)
    }
  }
  throw lastError ?? new Error('Deep Research fetch deadline exhausted.')
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, map: (item: T) => Promise<R>, isCancelled: () => boolean, onCancelled: (item: T) => R): Promise<R[]> {
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

const lookupPublicAddresses: ResearchHostLookup = async (hostname) => {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true })
  return addresses.map((entry) => entry.address)
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
  const lookup = options.lookup ?? lookupPublicAddresses
  const isCancelled = options.isCancelled ?? (() => false)

  function failureOutcome(run: ResearchRunDto, source: ResearchSourceDto, error: { code: string; message: string; retryable: boolean }): FetchOutcome {
    repositories.researchEventRepo.append({
      runId: run.id,
      type: 'research.source.fetch_failed',
      phase: 'fetching',
      payload: { sourceId: source.id, errorCode: error.code },
    })
    return { sourceId: source.id, status: 'failed', snapshot: null, error }
  }

  async function fetchOne(run: ResearchRunDto, source: ResearchSourceDto): Promise<FetchOutcome> {
    if (isCancelled(run.id)) return failureOutcome(run, source, { code: 'RESEARCH_CANCELLED', message: 'Deep Research run was cancelled.', retryable: false })
    const existingSnapshot = repositories.researchSourceRepo.getLatestSnapshotForSource(run.id, source.id)
    if (existingSnapshot) return { sourceId: source.id, status: 'fetched', snapshot: existingSnapshot, error: null }
    try {
      const initialUrl = await validatePublicResearchUrl(source.canonicalUrl, lookup)
      const fetched = await retryWithinDeadline(
        () => executeTool({ caller: 'workflow', toolId: 'web_fetch', input: { url: initialUrl, render: false, maxChars: 50_000 }, sessionId: run.sessionId ?? run.id }),
        run.usage.deadlineAt,
        sleep,
      )
      const fetchOutput = fetched.output as { finalUrl?: unknown; status?: unknown; content?: unknown }
      const fetchedFinalUrl = typeof fetchOutput.finalUrl === 'string' ? fetchOutput.finalUrl : initialUrl
      const safeFetchedFinalUrl = await validatePublicResearchUrl(fetchedFinalUrl, lookup)
      if (isCancelled(run.id)) return failureOutcome(run, source, { code: 'RESEARCH_CANCELLED', message: 'Deep Research run was cancelled.', retryable: false })
      const extracted = await retryWithinDeadline(
        () => executeTool({ caller: 'workflow', toolId: 'web_extract', input: { url: safeFetchedFinalUrl, render: false, maxChars: 50_000 }, sessionId: run.sessionId ?? run.id }),
        run.usage.deadlineAt,
        sleep,
      )
      const extractOutput = extracted.output as { finalUrl?: unknown; text?: unknown; title?: unknown; headings?: unknown }
      const finalUrl = await validatePublicResearchUrl(typeof extractOutput.finalUrl === 'string' ? extractOutput.finalUrl : safeFetchedFinalUrl, lookup)
      const content = sanitizeContent(typeof extractOutput.text === 'string' && extractOutput.text.trim()
        ? extractOutput.text
        : typeof fetchOutput.content === 'string' ? fetchOutput.content : '')
      if (!content) throw new Error('RESEARCH_FETCH_FAILED: no readable source content was returned.')
      const contentHash = crypto.createHash('sha256').update(content).digest('hex')
      const snapshot = repositories.researchSourceRepo.createSnapshot({
        runId: run.id,
        sourceId: source.id,
        contentHash,
        content,
        metadata: {
          title: typeof extractOutput.title === 'string' ? extractOutput.title : source.title ?? '',
          headings: Array.isArray(extractOutput.headings) ? extractOutput.headings.filter((heading): heading is string => typeof heading === 'string').slice(0, 40) : [],
        },
        fetchedAt: Date.now(),
        parserVersion: 'deepresearch-web-extract-v1',
        finalUrl,
        httpStatus: typeof fetchOutput.status === 'number' ? fetchOutput.status : null,
        idempotencyKey: createSnapshotFingerprint({ runId: run.id, sourceId: source.id, finalUrl, parserVersion: 'deepresearch-web-extract-v1', contentHash }),
      })
      return { sourceId: source.id, status: 'fetched', snapshot, error: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return failureOutcome(run, source, { code: message.startsWith('RESEARCH_UNSAFE_URL') ? 'RESEARCH_UNSAFE_URL' : 'RESEARCH_FETCH_FAILED', message, retryable: isRetryableError(error) })
    }
  }

  return {
    fetch(run: ResearchRunDto, sources: ResearchSourceDto[], requestOptions: { isCancelled?: () => boolean } = {}): Promise<FetchOutcome[]> {
      const limited = sources.slice(0, Math.max(0, run.budget.maxFetchedSources - run.usage.fetchedSources))
      const cancelled = requestOptions.isCancelled ?? (() => isCancelled(run.id))
      return mapWithConcurrency(
        limited,
        options.maxConcurrency ?? run.budget.fetchConcurrency,
        (source) => fetchOne(run, source),
        cancelled,
        (source) => failureOutcome(run, source, { code: 'RESEARCH_CANCELLED', message: 'Deep Research run was cancelled.', retryable: false }),
      )
    },
  }
}
