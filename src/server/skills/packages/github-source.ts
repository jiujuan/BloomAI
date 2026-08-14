import crypto from 'node:crypto'
import { SkillSecurityError, validateExternalSource } from '../security/skill-security-checklist'

export type GitHubSource = {
  kind: 'github-archive'
  repositoryUrl: string
  ref: string
  subdirectory?: string
}

export type ParsedGitHubSource = GitHubSource & {
  owner: string
  repository: string
}

export type GitHubSourceErrorCode =
  | 'GITHUB_SOURCE_INVALID'
  | 'GITHUB_REF_NOT_FOUND'
  | 'GITHUB_ARCHIVE_NOT_FOUND'
  | 'GITHUB_RATE_LIMITED'
  | 'GITHUB_UNAUTHORIZED'
  | 'GITHUB_REDIRECT_BLOCKED'
  | 'GITHUB_NETWORK_ERROR'
  | 'GITHUB_TIMEOUT'
  | 'GITHUB_ARCHIVE_TOO_LARGE'
  | 'GITHUB_CONTENT_LENGTH_MISMATCH'
  | 'GITHUB_INVALID_COMMIT_SHA'
  | 'GITHUB_API_ERROR'
  | 'GITHUB_ARCHIVE_ERROR'

export class GitHubSourceError extends Error {
  readonly code: GitHubSourceErrorCode
  readonly details?: Record<string, string | number | boolean>

  constructor(code: GitHubSourceErrorCode, message: string, details?: Record<string, string | number | boolean>) {
    super(message)
    this.name = 'GitHubSourceError'
    this.code = code
    this.details = details
  }
}

export type GitHubFetch = (input: string | URL, init?: RequestInit) => Promise<Response>
type FetchImpl = GitHubFetch

type RequestOptions = {
  fetchImpl?: FetchImpl
  timeoutMs?: number
  allowedHosts?: readonly string[]
}

export type ResolveCommitResult = {
  commitSha: string
  apiUrl: string
}

export type DownloadArchiveOptions = RequestOptions & {
  maxArchiveBytes?: number
  now?: () => Date
  maxRedirects?: number
  allowedHosts?: readonly string[]
}

export type DownloadedGitHubArchive = {
  archive: Buffer
  sourceUrl: string
  archiveUrl: string
  sourceRef: string
  resolvedCommitSha: string
  archiveSha256: string
  fetchedAt: string
  etag?: string
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 3
const ALLOWED_HOSTS = new Set(['github.com', 'api.github.com', 'codeload.github.com'])
const ARCHIVE_HOSTS = new Set(['github.com', 'codeload.github.com'])
const OWNER_OR_REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const VALID_SHA = /^[a-f0-9]{40}$/i
const ARCHIVE_REF_NAMESPACES = ['heads', 'tags'] as const

type ArchiveCandidate = {
  url: string
  expectedPaths: readonly string[]
}

export function parseGitHubSource(repositoryUrl: string, ref: string, subdirectory?: string): ParsedGitHubSource {
  const validated = validateGitHubSource(repositoryUrl, ref, subdirectory)
  repositoryUrl = validated.repositoryUrl
  ref = validated.ref
  subdirectory = validated.subdirectory
  if (typeof repositoryUrl !== 'string' || !repositoryUrl.trim()) {
    throw new GitHubSourceError('GITHUB_SOURCE_INVALID', 'GitHub repository URL is required')
  }
  if (typeof ref !== 'string' || !ref.trim()) {
    throw new GitHubSourceError('GITHUB_SOURCE_INVALID', 'GitHub ref is required')
  }
  if (ref !== ref.trim() || ref.length > 256 || /[\s\u0000-\u001f\u007f?#\\]/.test(ref)) {
    throw new GitHubSourceError('GITHUB_SOURCE_INVALID', 'GitHub ref contains invalid characters')
  }

  let url: URL
  try {
    url = new URL(repositoryUrl)
  } catch {
    throw new GitHubSourceError('GITHUB_SOURCE_INVALID', 'GitHub repository URL must be valid')
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.port || url.username || url.password) {
    throw new GitHubSourceError('GITHUB_SOURCE_INVALID', 'Only https://github.com repository URLs are supported')
  }
  if (url.search || url.hash) {
    throw new GitHubSourceError('GITHUB_SOURCE_INVALID', 'GitHub repository URL must not contain a query or fragment')
  }

  const segments = url.pathname.split('/').filter(Boolean).map((segment) => {
    try { return decodeURIComponent(segment) } catch { return '' }
  })
  const repository = segments[1]?.replace(/\.git$/, '')
  if (
    segments.length !== 2
    || !OWNER_OR_REPOSITORY.test(segments[0] ?? '')
    || !repository
    || !OWNER_OR_REPOSITORY.test(repository)
  ) {
    throw new GitHubSourceError('GITHUB_SOURCE_INVALID', 'GitHub repository URL must identify exactly one owner and repository')
  }

  return {
    kind: 'github-archive',
    repositoryUrl,
    ref,
    ...(subdirectory ? { subdirectory } : {}),
    owner: segments[0],
    repository,
  }
}

export async function resolveGitHubCommit(
  source: GitHubSource | ParsedGitHubSource,
  options: RequestOptions = {},
): Promise<ResolveCommitResult> {
  const parsed = ensureParsedSource(source)
  const allowedHosts = normalizeAllowedHosts(options.allowedHosts)
  if (!allowedHosts.has('api.github.com')) throw new GitHubSourceError('GITHUB_SOURCE_INVALID', 'GitHub API host is not enabled by the allowlist')
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/commits/${encodeURIComponent(parsed.ref)}`
  let response: Response
  try {
    response = await fetchWithTimeout(apiUrl, { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs }, { redirect: 'manual' })
  } catch (error) {
    throw mapFetchError(error, 'GitHub commit lookup failed')
  }
  if (isRedirect(response.status)) {
    throw new GitHubSourceError('GITHUB_REDIRECT_BLOCKED', 'GitHub API redirect was blocked')
  }
  if (!response.ok) throw mapGitHubStatus(response, 'GitHub ref could not be resolved', 'ref')

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new GitHubSourceError('GITHUB_API_ERROR', 'GitHub commit response was not valid JSON')
  }
  const commitSha = typeof payload === 'object' && payload !== null && 'sha' in payload && typeof payload.sha === 'string'
    ? payload.sha.toLowerCase()
    : ''
  if (!VALID_SHA.test(commitSha)) {
    throw new GitHubSourceError('GITHUB_INVALID_COMMIT_SHA', 'GitHub did not return a valid 40-character commit SHA')
  }
  return { commitSha, apiUrl }
}

export async function downloadGitHubArchive(
  source: GitHubSource | ParsedGitHubSource,
  commitSha: string,
  options: DownloadArchiveOptions = {},
): Promise<DownloadedGitHubArchive> {
  const parsed = ensureParsedSource(source)
  if (!VALID_SHA.test(commitSha)) {
    throw new GitHubSourceError('GITHUB_INVALID_COMMIT_SHA', 'GitHub archive requires a valid 40-character commit SHA')
  }
  const resolvedCommitSha = commitSha.toLowerCase()
  const maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES
  if (!Number.isSafeInteger(maxArchiveBytes) || maxArchiveBytes < 1) {
    throw new GitHubSourceError('GITHUB_SOURCE_INVALID', 'GitHub archive byte limit must be a positive integer')
  }
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const allowedHosts = normalizeAllowedHosts(options.allowedHosts)
  if (!allowedHosts.has('github.com')) throw new GitHubSourceError('GITHUB_SOURCE_INVALID', 'GitHub archive host is not enabled by the allowlist')
  let lastNotFound: GitHubSourceError | undefined

  for (const candidate of buildArchiveCandidates(parsed, resolvedCommitSha)) {
    let archiveUrl = candidate.url
    let response: Response | undefined
    let redirects = 0

    while (true) {
      try {
        response = await fetchWithTimeout(archiveUrl, { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs }, { redirect: 'manual' })
      } catch (error) {
        throw mapFetchError(error, 'GitHub archive download failed')
      }
      if (!isRedirect(response.status)) break
      if (redirects >= maxRedirects) throw new GitHubSourceError('GITHUB_REDIRECT_BLOCKED', 'GitHub archive exceeded the redirect limit')
      const location = response.headers.get('location')
      if (!location) throw new GitHubSourceError('GITHUB_REDIRECT_BLOCKED', 'GitHub archive redirect did not include a location')
      const nextUrl = validateArchiveRedirect(location, archiveUrl, candidate.expectedPaths, allowedHosts)
      archiveUrl = nextUrl
      redirects += 1
    }

    if (!response) throw new GitHubSourceError('GITHUB_ARCHIVE_ERROR', 'GitHub archive response was empty')
    if (!response.ok) {
      const error = mapGitHubStatus(response, 'GitHub archive could not be downloaded', 'archive')
      if (error.code === 'GITHUB_ARCHIVE_NOT_FOUND') {
        lastNotFound = error
        continue
      }
      throw error
    }

    const contentLengthHeader = response.headers.get('content-length')
    const contentLength = parseContentLength(contentLengthHeader)
    if (contentLength !== undefined && contentLength > maxArchiveBytes) {
      throw new GitHubSourceError('GITHUB_ARCHIVE_TOO_LARGE', 'GitHub archive exceeds the maximum allowed size', { maxArchiveBytes, contentLength })
    }
    const archive = await readResponseBuffer(response, maxArchiveBytes)
    if (contentLength !== undefined && archive.length !== contentLength) {
      throw new GitHubSourceError('GITHUB_CONTENT_LENGTH_MISMATCH', 'GitHub archive content-length does not match the response body', {
        contentLength,
        actualBytes: archive.length,
      })
    }

    return {
      archive,
      sourceUrl: parsed.repositoryUrl,
      archiveUrl,
      sourceRef: parsed.ref,
      resolvedCommitSha,
      archiveSha256: crypto.createHash('sha256').update(archive).digest('hex'),
      fetchedAt: (options.now ?? (() => new Date()))().toISOString(),
      ...(response.headers.get('etag') ? { etag: response.headers.get('etag') ?? undefined } : {}),
    }
  }

  throw lastNotFound ?? new GitHubSourceError('GITHUB_ARCHIVE_ERROR', 'GitHub archive response was empty')
}

function ensureParsedSource(source: GitHubSource | ParsedGitHubSource): ParsedGitHubSource {
  return parseGitHubSource(source.repositoryUrl, source.ref, source.subdirectory)
}

function validateGitHubSource(repositoryUrl: string, ref: string, subdirectory?: string): GitHubSource {
  try {
    return validateExternalSource({ kind: 'github-archive', repositoryUrl, ref, subdirectory }) as GitHubSource
  } catch (error) {
    if (error instanceof SkillSecurityError) throw new GitHubSourceError('GITHUB_SOURCE_INVALID', error.message)
    throw error
  }
}

function buildArchiveCandidates(source: ParsedGitHubSource, commitSha: string): ArchiveCandidate[] {
  const encodedRef = encodeGitHubRef(source.ref)
  // GitHub's public archive routes use refs/heads and refs/tags, and redirect
  // those stable URLs to the matching codeload ref path. Keep the resolved SHA
  // as a compatibility fallback for refs that are not exposed through either
  // namespace.
  const candidates: ArchiveCandidate[] = ARCHIVE_REF_NAMESPACES.map((namespace) => {
    const githubPath = `/${source.owner}/${source.repository}/archive/refs/${namespace}/${encodedRef}.zip`
    const codeloadPath = `/${source.owner}/${source.repository}/zip/refs/${namespace}/${encodedRef}`
    return {
      url: `https://github.com${githubPath}`,
      expectedPaths: [
        githubPath,
        codeloadPath,
        `/${source.owner}/${source.repository}/archive/${commitSha}.zip`,
        `/${source.owner}/${source.repository}/zip/${commitSha}`,
      ],
    }
  })
  const githubArchivePath = `/${source.owner}/${source.repository}/archive/${commitSha}.zip`
  const codeloadArchivePath = `/${source.owner}/${source.repository}/zip/${commitSha}`
  candidates.push({
    url: `https://github.com${githubArchivePath}`,
    expectedPaths: [githubArchivePath, codeloadArchivePath],
  })
  return candidates
}

function encodeGitHubRef(ref: string): string {
  return ref.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

function validateArchiveRedirect(location: string, currentUrl: string, expectedPaths: readonly string[], allowedHosts: ReadonlySet<string>): string {
  let nextUrl: URL
  try { nextUrl = new URL(location, currentUrl) } catch { throw new GitHubSourceError('GITHUB_REDIRECT_BLOCKED', 'GitHub archive redirect URL was invalid') }
  if (nextUrl.protocol !== 'https:' || !ALLOWED_HOSTS.has(nextUrl.hostname.toLowerCase()) || !allowedHosts.has(nextUrl.hostname.toLowerCase()) || !ARCHIVE_HOSTS.has(nextUrl.hostname.toLowerCase()) || nextUrl.port || nextUrl.username || nextUrl.password || nextUrl.search || nextUrl.hash) {
    throw new GitHubSourceError('GITHUB_REDIRECT_BLOCKED', 'GitHub archive redirect target is not an allowed GitHub host')
  }
  const pathName = nextUrl.pathname
  if (!expectedPaths.includes(pathName)) {
    throw new GitHubSourceError('GITHUB_REDIRECT_BLOCKED', 'GitHub archive redirect target is not the requested immutable archive')
  }
  return nextUrl.toString()
}

async function fetchWithTimeout(
  url: string,
  options: RequestOptions,
  init: RequestInit,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch as GitHubFetch
  if (typeof fetchImpl !== 'function') throw new GitHubSourceError('GITHUB_NETWORK_ERROR', 'Fetch is not available')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new GitHubSourceError('GITHUB_SOURCE_INVALID', 'GitHub request timeout must be a positive integer')
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const request = fetchImpl(url, { ...init, signal: controller.signal })
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new GitHubSourceError('GITHUB_TIMEOUT', `GitHub request timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([request, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function readResponseBuffer(response: Response, maxBytes: number): Promise<Buffer> {
  try {
    if (!response.body) {
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length > maxBytes) throw new GitHubSourceError('GITHUB_ARCHIVE_TOO_LARGE', 'GitHub archive exceeds the maximum allowed size', { maxArchiveBytes: maxBytes, actualBytes: buffer.length })
      return buffer
    }
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let totalBytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        totalBytes += value.byteLength
        if (totalBytes > maxBytes) throw new GitHubSourceError('GITHUB_ARCHIVE_TOO_LARGE', 'GitHub archive exceeds the maximum allowed size', { maxArchiveBytes: maxBytes, actualBytes: totalBytes })
        chunks.push(Buffer.from(value))
      }
    } finally {
      reader.releaseLock()
    }
    return Buffer.concat(chunks, totalBytes)
  } catch (error) {
    if (error instanceof GitHubSourceError) throw error
    throw mapFetchError(error, 'GitHub archive response could not be read')
  }
}

function mapFetchError(error: unknown, message: string): GitHubSourceError {
  if (error instanceof GitHubSourceError) return error
  if (error instanceof Error && error.name === 'AbortError') return new GitHubSourceError('GITHUB_TIMEOUT', message)
  return new GitHubSourceError('GITHUB_NETWORK_ERROR', message)
}

function mapGitHubStatus(response: Response, message: string, resource: 'ref' | 'archive'): GitHubSourceError {
  if (response.status === 404) return new GitHubSourceError(resource === 'ref' ? 'GITHUB_REF_NOT_FOUND' : 'GITHUB_ARCHIVE_NOT_FOUND', `${message}: GitHub returned 404`)
  if (response.status === 429 || response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    return new GitHubSourceError('GITHUB_RATE_LIMITED', `${message}: GitHub rate limit exceeded`)
  }
  if (response.status === 401 || response.status === 403) return new GitHubSourceError('GITHUB_UNAUTHORIZED', `${message}: GitHub authorization is required`)
  return new GitHubSourceError('GITHUB_API_ERROR', `${message}: GitHub returned HTTP ${response.status}`, { status: response.status })
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null) return undefined
  if (!/^\d+$/.test(value.trim())) throw new GitHubSourceError('GITHUB_CONTENT_LENGTH_MISMATCH', 'GitHub archive content-length header was invalid')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new GitHubSourceError('GITHUB_CONTENT_LENGTH_MISMATCH', 'GitHub archive content-length header was invalid')
  return parsed
}

function normalizeAllowedHosts(hosts: readonly string[] | undefined): ReadonlySet<string> {
  const values = hosts ? [...hosts].map((host) => host.toLowerCase()) : [...ALLOWED_HOSTS]
  if (values.some((host) => !ALLOWED_HOSTS.has(host))) throw new GitHubSourceError('GITHUB_SOURCE_INVALID', 'GitHub allowlist contains a non-official host')
  return new Set(values)
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400
}
