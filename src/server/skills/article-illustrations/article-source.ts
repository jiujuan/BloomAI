import { lookup as dnsLookup } from 'node:dns'
import { promises as dns } from 'node:dns'
import fs from 'node:fs'
import path from 'node:path'
import { isIP } from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'
import { z } from 'zod'
import { parseDocx, parsePdf, readTextFile } from '../../attachments/parsers'

const MAX_TEXT_LENGTH = 100_000
const MAX_FILE_BYTES = 15 * 1024 * 1024
const MAX_FETCH_BYTES = 2 * 1024 * 1024
const FETCH_TIMEOUT_MS = 10_000

const articleSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string(), title: z.string().max(300).optional() }),
  z.object({ type: z.literal('url'), url: z.string().url(), consent: z.boolean(), title: z.string().max(300).optional() }),
  z.object({ type: z.literal('file'), filePath: z.string().min(1), fileName: z.string().min(1).max(300) }),
])
export type ArticleSourceInput = z.infer<typeof articleSourceSchema>
export type ExtractedArticle = { title: string; text: string; sourceType: 'text' | 'url' | 'file'; sourceLabel: string; sourceUrl?: string }
export type ArticleLookup = (hostname: string) => Promise<string[]>
type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>

export class ArticleSourceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ArticleSourceError' }
}

export async function extractArticle(input: ArticleSourceInput, options: { fetchImpl?: FetchImplementation; lookup?: ArticleLookup } = {}): Promise<ExtractedArticle> {
  const source = articleSourceSchema.parse(input)
  if (source.type === 'text') {
    const text = normalizeText(source.text)
    return { title: source.title?.trim() || 'Pasted article', text, sourceType: 'text', sourceLabel: source.title?.trim() || 'Pasted article' }
  }
  if (source.type === 'file') return extractFile(source)
  if (!source.consent) throw new ArticleSourceError('URL_CONSENT_REQUIRED', 'Allow server-side fetching before importing an article URL.')
  return extractUrl(source, options)
}

async function extractUrl(source: Extract<ArticleSourceInput, { type: 'url' }>, options: { fetchImpl?: FetchImplementation; lookup?: ArticleLookup }): Promise<ExtractedArticle> {
  const url = validateUrl(source.url)
  const lookup = options.lookup ?? lookupPublicAddresses
  await assertPublicHost(url.hostname, lookup)

  let response: any
  try {
    response = options.fetchImpl
      ? await options.fetchImpl(url.toString(), { redirect: 'manual' })
      : await fetchWithPinnedPublicLookup(url, lookup)
  } catch (error) {
    if (error instanceof ArticleSourceError) throw error
    throw new ArticleSourceError('ARTICLE_FETCH_FAILED', 'The server could not fetch this URL. Paste the article text instead.')
  }
  if (response.status >= 300 && response.status < 400) throw new ArticleSourceError('ARTICLE_FETCH_FAILED', 'Redirected URLs are not imported. Paste the article text instead.')
  if (!response.ok) throw new ArticleSourceError('ARTICLE_FETCH_FAILED', 'The server could not fetch this URL. Paste the article text instead.')
  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  if (contentType && !/^(text\/html|text\/plain|text\/markdown)(;|$)/.test(contentType)) {
    throw new ArticleSourceError('ARTICLE_FETCH_FAILED', 'The URL did not return article text. Paste the article text instead.')
  }
  const htmlOrText = await readBoundedResponse(response)
  const title = source.title?.trim() || extractTitle(htmlOrText) || url.hostname
  const text = normalizeText(contentType.includes('html') ? htmlToText(htmlOrText) : htmlOrText)
  return { title, text, sourceType: 'url', sourceLabel: title, sourceUrl: url.toString() }
}

async function extractFile(source: Extract<ArticleSourceInput, { type: 'file' }>): Promise<ExtractedArticle> {
  const extension = path.extname(source.fileName).toLowerCase()
  if (!['.md', '.markdown', '.txt', '.docx', '.pdf'].includes(extension)) throw new ArticleSourceError('UNSUPPORTED_ARTICLE_FILE', 'Only MD, TXT, DOCX, and PDF article files are supported.')
  let size: number
  try { size = fs.statSync(source.filePath).size } catch { throw new ArticleSourceError('ARTICLE_FILE_UNREADABLE', 'The uploaded article file is no longer available.') }
  if (size > MAX_FILE_BYTES) throw new ArticleSourceError('ARTICLE_FILE_TOO_LARGE', 'Article files must be 15 MB or smaller.')
  try {
    const raw = extension === '.pdf' ? (await parsePdf(source.filePath)).text
      : extension === '.docx' ? (await parseDocx(source.filePath)).text || ''
      : readTextFile(source.filePath)
    return { title: source.fileName, text: normalizeText(raw), sourceType: 'file', sourceLabel: source.fileName }
  } catch (error) {
    if (error instanceof ArticleSourceError) throw error
    throw new ArticleSourceError('ARTICLE_FILE_UNREADABLE', 'The article file could not be read.')
  }
}

export function normalizeText(value: string): string {
  const normalized = value.replace(/\r\n?/g, '\n').replace(/[\t \f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!normalized) throw new ArticleSourceError('ARTICLE_TEXT_EMPTY', 'Article text cannot be empty.')
  if (normalized.length > MAX_TEXT_LENGTH) throw new ArticleSourceError('ARTICLE_TEXT_TOO_LONG', 'Article text must be 100,000 characters or fewer.')
  return normalized
}

function validateUrl(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new ArticleSourceError('URL_NOT_ALLOWED', 'Enter a valid HTTP or HTTPS URL.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ArticleSourceError('URL_NOT_ALLOWED', 'Only public HTTP or HTTPS URLs without credentials can be fetched.')
  if (isIP(url.hostname) && !isPublicAddress(url.hostname)) throw new ArticleSourceError('URL_NOT_ALLOWED', 'Private, local, or reserved addresses cannot be fetched.')
  if (url.hostname.toLowerCase() === 'localhost' || url.hostname.endsWith('.localhost')) throw new ArticleSourceError('URL_NOT_ALLOWED', 'Local URLs cannot be fetched.')
  return url
}

async function assertPublicHost(hostname: string, lookup: ArticleLookup): Promise<void> {
  if (isIP(hostname)) return
  let addresses: string[]
  try { addresses = await lookup(hostname) } catch { throw new ArticleSourceError('ARTICLE_FETCH_FAILED', 'The URL host could not be resolved. Paste the article text instead.') }
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) throw new ArticleSourceError('URL_NOT_ALLOWED', 'Private, local, or reserved addresses cannot be fetched.')
}

async function lookupPublicAddresses(hostname: string): Promise<string[]> {
  const result = await dns.lookup(hostname, { all: true, verbatim: true })
  return result.map((entry) => entry.address)
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

async function fetchWithPinnedPublicLookup(url: URL, lookup: ArticleLookup): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const dispatcher = new Agent({
    connect: {
      lookup(hostname: string, _options: unknown, callback: (error: Error | null, address?: string, family?: number) => void) {
        lookup(hostname).then((addresses) => {
          const address = addresses.find(isPublicAddress)
          if (!address || addresses.some((candidate) => !isPublicAddress(candidate))) return callback(new Error('Unsafe host'))
          callback(null, address, isIP(address))
        }).catch((error) => callback(error instanceof Error ? error : new Error('DNS lookup failed')))
      },
    },
  } as any)
  try {
    return await undiciFetch(url, { dispatcher, redirect: 'manual', signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    void dispatcher.close()
  }
}

async function readBoundedResponse(response: any): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') || '0')
  if (contentLength > MAX_FETCH_BYTES) throw new ArticleSourceError('ARTICLE_FETCH_FAILED', 'The fetched article is too large. Paste a shorter excerpt instead.')
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_FETCH_BYTES) { await reader.cancel(); throw new ArticleSourceError('ARTICLE_FETCH_FAILED', 'The fetched article is too large. Paste a shorter excerpt instead.') }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
}

function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
}
function extractTitle(html: string): string | undefined {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  return title ? decodeEntities(title).replace(/\s+/g, ' ').trim().slice(0, 300) : undefined
}
function decodeEntities(value: string): string {
  return value.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
}

// Keep the callback API import visible to make the pinned lookup intent auditable in code review.
void dnsLookup