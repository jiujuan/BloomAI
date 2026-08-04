import type {
  WebSearchOutput,
  WebSearchProvider,
  WebSearchRequest,
} from './contracts'

const DEFAULT_TIMEOUT_MS = 8_000
const MAX_RESULTS = 20

export type AnySearchSearchProviderOptions = {
  endpoint: string
  apiKey?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class AnySearchApiError extends Error {
  readonly status?: number
  readonly apiCode?: number | string
  readonly requestId?: string
  readonly retryAfter?: string

  constructor(message: string, details: {
    status?: number
    apiCode?: number | string
    requestId?: string
    retryAfter?: string
  } = {}) {
    super(message)
    this.name = 'AnySearchApiError'
    this.status = details.status
    this.apiCode = details.apiCode
    this.requestId = details.requestId
    this.retryAfter = details.retryAfter
  }
}

export function createAnySearchSearchProvider(
  options: AnySearchSearchProviderOptions,
): WebSearchProvider {
  const fetchImpl = options.fetchImpl ?? fetch
  return {
    id: 'anysearch',
    search: (request) => searchAnySearch(request, options, fetchImpl),
  }
}

async function searchAnySearch(
  request: WebSearchRequest,
  options: AnySearchSearchProviderOptions,
  fetchImpl: typeof fetch,
): Promise<WebSearchOutput> {
  const response = await fetchImpl(options.endpoint, {
    method: 'POST',
    headers: buildHeaders(options.apiKey),
    body: JSON.stringify(buildRequestBody(request)),
    signal: combineSignals(request.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })

  const responseBody = await readResponseBody(response)
  const responseRecord = asRecord(responseBody)
  const apiCode = readCode(responseRecord?.code)
  const message = firstString(
    responseRecord?.message,
    typeof responseBody === 'string' ? responseBody : undefined,
  ) ?? 'Unknown AnySearch API error'
  const requestId = firstString(responseRecord?.request_id)
  const retryAfter = readRetryAfter(response)

  if (!response.ok) {
    throw new AnySearchApiError(
      formatApiError('request failed with HTTP', response.status, apiCode, message, requestId),
      { status: response.status, apiCode, requestId, retryAfter },
    )
  }
  if (apiCode !== undefined && !isSuccessCode(apiCode)) {
    throw new AnySearchApiError(
      formatApiError('error', undefined, apiCode, message, requestId),
      { apiCode, requestId, retryAfter },
    )
  }

  const data = asRecord(responseRecord?.data)
  const results = normalizeResults(data?.results, request.query, request.limit)
  return {
    query: request.query,
    total: results.length,
    provider: 'anysearch',
    results,
    ...(request.fallbackFrom ? { fallbackFrom: request.fallbackFrom } : {}),
    ...(request.fallbackReason ? { fallbackReason: request.fallbackReason } : {}),
  }
}

function buildHeaders(apiKey: string | undefined): Record<string, string> {
  return {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    'Content-Type': 'application/json',
  }
}

function buildRequestBody(request: WebSearchRequest): Record<string, unknown> {
  return {
    query: request.query,
    max_results: Math.min(Math.max(Math.trunc(request.limit), 1), MAX_RESULTS),
    ...(request.tag ? { tag: request.tag } : {}),
    ...(request.zone ? { zone: request.zone } : {}),
    ...(request.language ? { language: request.language } : {}),
    ...(request.params ? { params: request.params } : {}),
    ...(request.format ? { format: request.format } : {}),
  }
}

function normalizeResults(value: unknown, query: string, limit: number): WebSearchOutput['results'] {
  const results: WebSearchOutput['results'] = []
  for (const item of asArray(value)) {
    const record = asRecord(item)
    const url = firstString(record?.url)
    if (!url) continue
    const title = firstString(record?.title, url, query) ?? query
    const snippet = firstString(record?.snippet, record?.content, title) ?? ''
    results.push({ title, url, snippet })
    if (results.length >= limit) break
  }
  return results
}

function formatApiError(
  prefix: string,
  status: number | undefined,
  apiCode: number | string | undefined,
  message: string,
  requestId: string | undefined,
): string {
  const statusText = status === undefined ? '' : ` ${status}`
  const codeText = apiCode === undefined ? '' : ` (${String(apiCode)})`
  const requestIdText = requestId ? ` (request_id=${requestId})` : ''
  return `AnySearch API ${prefix}${statusText}${codeText}: ${message}${requestIdText}`
}

async function readResponseBody(response: Response): Promise<unknown> {
  let text = ''
  try {
    text = await response.text()
  } catch {
    return undefined
  }
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function readRetryAfter(response: Response): string | undefined {
  return typeof response.headers?.get === 'function'
    ? response.headers.get('Retry-After') ?? undefined
    : undefined
}

function readCode(value: unknown): number | string | undefined {
  if (typeof value === 'number' || typeof value === 'string') return value
  return undefined
}

function isSuccessCode(code: number | string): boolean {
  return code === 0 || code === '0'
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function combineSignals(upstream: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return upstream ? AbortSignal.any([upstream, timeoutSignal]) : timeoutSignal
}
