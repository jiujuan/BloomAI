import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'

export type UrlLookup = (hostname: string) => Promise<string[]>

export type UrlPolicyOptions = {
  allowedProtocols?: readonly string[]
  maxUrlLength?: number
  lookup?: UrlLookup
}

export type BrowserRouteLike = {
  request(): { url(): string }
  continue(): Promise<unknown>
  abort(errorCode?: string): Promise<unknown>
}

const DEFAULT_PROTOCOLS = ['http:', 'https:'] as const

export class UrlPolicyError extends Error {
  constructor(message: string) {
    super(`unsafe external URL: ${message}`)
    this.name = 'UrlPolicyError'
  }
}

export function parseExternalUrl(rawUrl: string, options: UrlPolicyOptions = {}): URL {
  const maxUrlLength = options.maxUrlLength ?? 8_192
  if (!rawUrl || rawUrl.length > maxUrlLength) throw new UrlPolicyError('URL is empty or too long')

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new UrlPolicyError('URL must be valid')
  }

  const allowedProtocols = options.allowedProtocols ?? DEFAULT_PROTOCOLS
  if (!allowedProtocols.includes(url.protocol)) throw new UrlPolicyError('only HTTP(S) protocols are allowed')
  if (!url.hostname || url.username || url.password) throw new UrlPolicyError('credentials and empty hosts are not allowed')

  const host = stripIpv6Brackets(url.hostname).toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new UrlPolicyError('private or local hostnames are not allowed')
  }
  const version = isIP(host)
  if (version !== 0 && !isPublicAddress(host)) {
    throw new UrlPolicyError('private or local addresses are not allowed')
  }
  return url
}

export async function validateInitialUrl(rawUrl: string, options: UrlPolicyOptions = {}): Promise<URL> {
  const url = parseExternalUrl(rawUrl, options)
  await assertPublicHost(url, options)
  return url
}

export async function assertPublicHost(url: URL, options: UrlPolicyOptions = {}): Promise<void> {
  const host = stripIpv6Brackets(url.hostname).toLowerCase()
  const version = isIP(host)
  if (version !== 0) {
    if (!isPublicAddress(host)) throw new UrlPolicyError('private or local addresses are not allowed')
    return
  }

  const lookup = options.lookup ?? lookupAll
  let addresses: string[]
  try {
    addresses = await lookup(host)
  } catch {
    throw new UrlPolicyError('host could not be resolved safely')
  }
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
    throw new UrlPolicyError('private or local DNS results are not allowed')
  }
}

export async function validateRedirectUrl(location: string, baseUrl: string, options: UrlPolicyOptions = {}): Promise<URL> {
  let redirected: URL
  try {
    redirected = new URL(location, baseUrl)
  } catch {
    throw new UrlPolicyError('redirect target must be valid')
  }
  return validateInitialUrl(redirected.toString(), options)
}

export function isPublicAddress(address: string): boolean {
  const value = stripIpv6Brackets(address).toLowerCase()
  const version = isIP(value)
  if (version === 4) return isPublicIpv4(value)
  if (version === 6) return isPublicIpv6(value)
  return false
}

export function isPrivateOrLocalAddress(address: string, version = isIP(address)): boolean {
  if (version === 0) return true
  return !isPublicAddress(address)
}

export function createBrowserRequestGuard(
  validateUrl: (url: string) => Promise<URL> = (url) => validateInitialUrl(url),
): (route: BrowserRouteLike, signal?: AbortSignal) => Promise<boolean> {
  return async (route, signal) => {
    if (signal?.aborted) {
      await route.abort('aborted').catch(() => {})
      return false
    }
    const requestUrl = route.request().url()
    if (/^(?:data|blob|about):/i.test(requestUrl)) {
      await route.continue()
      return true
    }
    try {
      await validateUrl(requestUrl)
      await route.continue()
      return true
    } catch {
      await route.abort('blockedbyclient').catch(() => {})
      return false
    }
  }
}

async function lookupAll(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true })
  return records.map((record) => record.address)
}

function isPublicIpv4(value: string): boolean {
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b, c] = parts
  return !(a === 0
    || a === 10
    || a === 100 && b >= 64 && b <= 127
    || a === 127
    || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 0
    || a === 192 && b === 168
    || a === 198 && b === 18
    || a === 198 && b === 19
    || a === 198 && b === 51 && c === 100
    || a === 203 && b === 0 && c === 113
    || a >= 224)
}

function isPublicIpv6(value: string): boolean {
  if (value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value) || value.startsWith('ff')) return false
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mapped) return isPublicIpv4(mapped[1])
  const expanded = expandIpv6(value)
  if (!expanded) return false
  const first = parseInt(expanded[0], 16)
  return first !== 0 && first < 0xff00
}

function expandIpv6(value: string): string[] | null {
  const halves = value.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (left.some((part) => !/^[0-9a-f]{1,4}$/i.test(part)) || right.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null
  const missing = 8 - left.length - right.length
  if (missing < 0 || halves.length === 1 && missing !== 0) return null
  return [...left, ...Array.from({ length: missing }, () => '0'), ...right]
}

function stripIpv6Brackets(value: string): string {
  return value.replace(/^\[|\]$/g, '')
}

export const validateExternalUrl = validateInitialUrl
export const validateRedirectTarget = validateRedirectUrl
export const validateResolvedHost = assertPublicHost
