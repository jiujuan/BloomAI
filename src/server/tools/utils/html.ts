/**
 * Shared HTML fetching + extraction helpers used by the web_fetch / web_extract tools.
 *
 * Goals (all dependency-free):
 *  - Fetch with realistic browser headers and follow redirects.
 *  - Detect the page charset (HTTP header + <meta>) and decode correctly,
 *    so non-UTF-8 pages (GBK/GB2312/Big5/Shift_JIS ...) are not garbled.
 *  - Strip boilerplate (script/style/nav/header/footer/...) and pull out the
 *    main article content instead of the whole noisy page.
 *  - Decode HTML entities and normalise whitespace into readable plain text.
 */

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const DEFAULT_TIMEOUT_MS = 12000

export interface FetchedPage {
  /** Requested URL. */
  url: string
  /** Final URL after redirects. */
  finalUrl: string
  status: number
  contentType: string
  charset: string
  /** Fully decoded HTML/text body. */
  html: string
}

export interface FetchPageOptions {
  timeoutMs?: number
  userAgent?: string
  /** Optional cap on bytes read from the response (defaults to 5 MB). */
  maxBytes?: number
}

/** Fetch a page and decode it with the correct charset. */
export async function fetchPage(url: string, opts: FetchPageOptions = {}): Promise<FetchedPage> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, userAgent = DEFAULT_UA, maxBytes = 5 * 1024 * 1024 } = opts

  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
    },
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!res.ok) {
    throw new Error(`Fetch failed with HTTP ${res.status} ${res.statusText} for ${url}`)
  }

  const contentType = res.headers.get('content-type') || ''
  const buffer = await readBodyLimited(res, maxBytes)
  const charset = detectCharset(buffer, contentType)
  const html = decodeBuffer(buffer, charset)

  return { url, finalUrl: res.url || url, status: res.status, contentType, charset, html }
}

async function readBodyLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const buf = new Uint8Array(await res.arrayBuffer())
  return buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf
}

/** Decode a byte buffer using the given charset, falling back to UTF-8. */
export function decodeBuffer(buffer: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset as any, { fatal: false }).decode(buffer)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  }
}

/**
 * Detect page charset from (1) BOM, (2) HTTP Content-Type header,
 * (3) <meta charset> / <meta http-equiv>. Defaults to utf-8.
 */
export function detectCharset(buffer: Uint8Array, contentType: string): string {
  // BOM sniffing.
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 'utf-8'
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf-16le'
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf-16be'

  const fromHeader = contentType.match(/charset=["']?([^;"'\s]+)/i)?.[1]
  if (fromHeader) return normaliseCharset(fromHeader)

  // Sniff the first ~4KB as latin1 to find a <meta> declaration without needing
  // to know the encoding yet (ASCII bytes survive latin1 decoding).
  const head = new TextDecoder('latin1').decode(buffer.subarray(0, 4096))
  const metaCharset =
    head.match(/<meta[^>]+charset=["']?([^;"'>\s]+)/i)?.[1] ||
    head.match(/<meta[^>]+content=["'][^"']*charset=([^;"'>\s]+)/i)?.[1]
  if (metaCharset) return normaliseCharset(metaCharset)

  return 'utf-8'
}

function normaliseCharset(label: string): string {
  const c = label.trim().toLowerCase()
  // TextDecoder understands these labels; map the common aliases.
  if (c === 'gb2312' || c === 'gb_2312' || c === 'gbk' || c === 'gb-2312') return 'gb18030'
  if (c === 'iso-8859-1' || c === 'latin1' || c === 'us-ascii') return 'windows-1252'
  if (c === 'utf8') return 'utf-8'
  return c
}

// ----------------------------------------------------------------------------
// Content extraction
// ----------------------------------------------------------------------------

const BOILERPLATE_TAGS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'head',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'iframe',
  'button',
  'select',
  'textarea',
  'figure',
]

/** Remove tags (with their content) that never contain useful reading text. */
export function stripBoilerplate(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, '')
  // Drop <!doctype ...>, <![CDATA[...]]> and <?xml ...?> style declarations.
  out = out.replace(/<![^>]*>/g, ' ').replace(/<\?[\s\S]*?\?>/g, ' ')
  for (const tag of BOILERPLATE_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ')
    // Self-closing / unclosed variants.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), ' ')
  }
  return out
}

/**
 * Pick the main content region of a page. Prefers <article>/<main>; otherwise
 * scores block containers by text length and low link density (readability-lite).
 */
export function extractMainHtml(html: string): string {
  const cleaned = stripBoilerplate(html)

  const article = largestMatch(cleaned, /<article\b[^>]*>([\s\S]*?)<\/article>/gi)
  if (article && textLength(article) > 200) return article

  const main = largestMatch(cleaned, /<main\b[^>]*>([\s\S]*?)<\/main>/gi)
  if (main && textLength(main) > 200) return main

  // Score <div>/<section> blocks: reward text, penalise link-heavy blocks.
  let best = ''
  let bestScore = 0
  const blockRe = /<(?:div|section)\b[^>]*>([\s\S]*?)<\/(?:div|section)>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(cleaned))) {
    const inner = m[1]
    const len = textLength(inner)
    if (len < 200) continue
    const linkText = (inner.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []).reduce((n, a) => n + textLength(a), 0)
    const score = len - linkText * 3
    if (score > bestScore) {
      bestScore = score
      best = inner
    }
  }
  if (best && bestScore > 200) return best

  // Fall back to <body> or the whole cleaned document.
  const body = cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
  return body || cleaned
}

function largestMatch(html: string, re: RegExp): string {
  let best = ''
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (textLength(m[1]) > textLength(best)) best = m[1]
  }
  return best
}

function textLength(html: string): number {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length
}

/** Convert an HTML fragment to readable plain text (entities decoded). */
export function htmlToText(html: string): string {
  let out = stripBoilerplate(html)

  out = out.replace(/<br\s*\/?>/gi, '\n')
  out = out.replace(/<\/(p|div|section|article|li|ul|ol|tr|table|blockquote|pre|h[1-6]|dd|dt)>/gi, '\n')
  out = out.replace(/<(h[1-6]|p|li|tr|blockquote)\b[^>]*>/gi, '\n')
  out = out.replace(/<\/td>|<\/th>/gi, '\t')

  // Drop any remaining tags.
  out = out.replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
  out = decodeEntities(out)

  // Normalise whitespace.
  out = out
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return out
}

/** Strip all tags from a small fragment (e.g. a heading) and decode entities. */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<\/?[a-zA-Z][^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  deg: '°',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  times: '×',
  divide: '÷',
}

/** Decode numeric (&#123; / &#xAB;) and common named HTML entities. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (whole, name) => NAMED_ENTITIES[name] ?? whole)
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

/** Extract the <title>, decoded. */
export function extractTitle(html: string): string {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  return raw ? stripTags(raw) : ''
}

/** Extract the meta description, decoded. */
export function extractMetaDescription(html: string): string {
  const raw =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i)?.[1]
  return raw ? decodeEntities(raw).trim() : ''
}

/** Resolve a possibly-relative href against a base URL. */
export function resolveUrl(base: string, href: string): string {
  try {
    return new URL(href, base).href
  } catch {
    return href
  }
}
