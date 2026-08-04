import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'

export type UrlLookup = (hostname: string) => Promise<string[]>

export type UrlPolicyOptions = {
  allowedProtocols?: readonly string[]
  maxUrlLength?: number
  lookup?: UrlLookup
}

const DEFAULT_PROTOCOLS = ['http:', 'https:'] as const

export class UrlPolicyError extends Error {
  constructor(message: string) {
    super(`unsafe external URL: ${message}`)
    this.name = 'UrlPolicyError'
  }
}

export async function validateExternalUrl(rawUrl: string, options: UrlPolicyOptions = {}): Promise<URL> {
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
  await validateResolvedHost(url, options)
  return url
}

export async function validateResolvedHost(url: URL, options: UrlPolicyOptions = {}): Promise<void> {
  const host = stripIpv6Brackets(url.hostname).toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new UrlPolicyError('private or local hostnames are not allowed')
  }

  const literalVersion = isIP(host)
  if (literalVersion !== 0) {
    if (isPrivateOrLocalAddress(host, literalVersion)) throw new UrlPolicyError('private or local addresses are not allowed')
    return
  }

  const lookup = options.lookup ?? lookupAll
  let addresses: string[]
  try {
    addresses = await lookup(host)
  } catch {
    throw new UrlPolicyError('host could not be resolved safely')
  }
  if (!addresses.length || addresses.some((address) => isPrivateOrLocalAddress(address, isIP(address)))) {
    throw new UrlPolicyError('private or local DNS results are not allowed')
  }
}

export async function validateRedirectTarget(location: string, baseUrl: string, options: UrlPolicyOptions = {}): Promise<URL> {
  let redirected: URL
  try {
    redirected = new URL(location, baseUrl)
  } catch {
    throw new UrlPolicyError('redirect target must be valid')
  }
  return validateExternalUrl(redirected.toString(), options)
}

export function isPrivateOrLocalAddress(address: string, version = isIP(address)): boolean {
  const value = stripIpv6Brackets(address).toLowerCase()
  if (version === 4) return isPrivateIpv4(value)
  if (version === 6) return isPrivateIpv6(value)
  return true
}

async function lookupAll(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true })
  return records.map((record) => record.address)
}

function isPrivateIpv4(value: string): boolean {
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b, c] = parts
  return a === 0
    || a === 10
    || a === 100 && b >= 64 && b <= 127
    || a === 127
    || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && (b === 0 || b === 168)
    || a === 192 && b === 0 && c === 0
    || a === 192 && b === 0 && c === 2
    || a === 198 && (b === 18 || b === 19 || b === 51)
    || a === 203 && b === 0 && c === 113
    || a >= 224
}

function isPrivateIpv6(value: string): boolean {
  if (value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value) || value.startsWith('ff')) return true
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIpv4(mapped[1])

  const expanded = expandIpv6(value)
  if (!expanded) return true
  const first = parseInt(expanded[0], 16)
  return first === 0 || first >= 0xff00
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
