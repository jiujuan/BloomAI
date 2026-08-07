import type { CriticalBlockedReport, HttpManualReviewReport, NormalizedLegacySource } from './migration.types'
import { redactWithStats } from './secret-redactor'
import { recordMigrationMetric } from '../observability/skill-runtime.metrics'

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
type UrlRisk = { code: string; severity: 'high' | 'critical'; message: string }

export function createHttpApiManualReviewReport(source: NormalizedLegacySource): HttpManualReviewReport {
  const config = readHttpConfig(source.source)
  const rawUrl = typeof config.url === 'string' ? config.url : ''
  const urlRisks = inspectUrlRisks(rawUrl, config)
  const headers = isRecord(config.headers) ? config.headers : {}
  const query = isRecord(config.query) ? config.query : {}
  const auth = summarizeAuth(headers, config)
  let redacted
  try {
    redacted = redactWithStats({ url: rawUrl, headers, query, body: config.body, env: config.env, log: config.log, artifact: config.artifact })
  } catch (error) {
    recordMigrationMetric('migration_secret_redaction_failed')
    throw error
  }
  const riskLevel = urlRisks.some((risk) => risk.severity === 'critical') || auth.present ? 'critical' : 'high'
  const bodyShape = summarizeShape(config.body)
  return {
    kind: 'manual-review-report',
    sourceType: 'http-api',
    legacySkillId: source.legacySkillId,
    sourceSha256: source.sourceSha256,
    lifecycle: 'manual_review_required',
    decision: 'manual_review',
    riskLevel,
    request: {
      url: typeof redacted.value.url === 'string' ? redacted.value.url : '',
      method: normalizeMethod(config.method),
      headerNames: Object.keys(headers).sort((a, b) => a.localeCompare(b)),
      queryKeys: queryKeys(rawUrl, query),
      bodyShape,
    },
    auth,
    urlRisks,
    requiredCapabilities: ['web.fetch'],
    manualActions: [
      'approve the endpoint against an explicit egress allowlist',
      'define timeout, retry, redirect and response-size policy',
      'replace embedded credentials with an approved secret reference',
      'review request/response schema and redact logs/artifacts',
      'grant web.fetch separately; migration does not inherit network capability',
    ],
    redaction: { redactedCount: redacted.stats.redactedCount },
    sideEffects: { network: false, database: false, queue: false, runner: false, publish: false },
  }
}

export function createJsFunctionCriticalBlockedReport(source: NormalizedLegacySource): CriticalBlockedReport {
  return {
    kind: 'critical-blocked-report',
    sourceType: 'js-function',
    legacySkillId: source.legacySkillId,
    sourceSha256: source.sourceSha256,
    lifecycle: 'migration_blocked',
    decision: 'critical_blocked',
    riskLevel: 'critical',
    blockers: [
      'arbitrary JavaScript source is not automatically translated',
      'the legacy function is never executed for analysis or sample output',
      'vm, eval, Function constructor, child_process and dynamic import are prohibited',
    ],
    rewriteGuidance: [
      'define typed JSON input and output schemas',
      'declare each external capability explicitly and scope it through Package policy',
      'rewrite the behavior as an auditable Package handler with deterministic tests',
      'perform human security review before any future implementation is published',
    ],
    sideEffects: { execution: false, vm: false, eval: false, functionConstructor: false, childProcess: false, dynamicImport: false, network: false, database: false },
  }
}

export const buildHttpManualReviewReport = createHttpApiManualReviewReport
export const buildJsFunctionCriticalBlockedReport = createJsFunctionCriticalBlockedReport

function readHttpConfig(source: unknown): Record<string, unknown> {
  if (isRecord(source)) return source
  if (typeof source === 'string') {
    try {
      const parsed: unknown = JSON.parse(source)
      if (isRecord(parsed)) return parsed
    } catch { /* A plain URL is still a valid analysis input. */ }
    return { url: source, method: 'GET' }
  }
  return { url: '' }
}

function inspectUrlRisks(rawUrl: string, config: Record<string, unknown>): UrlRisk[] {
  const risks: UrlRisk[] = []
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch {
    risks.push({ code: 'INVALID_URL', severity: 'critical', message: 'URL is missing or invalid; do not request it' })
    return risks
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    risks.push({ code: 'UNSAFE_SCHEME', severity: 'critical', message: 'Only http/https endpoints can be reviewed' })
  }

  const hostname = normalizeHostname(parsed.hostname)
  if (isLoopbackHost(hostname)) {
    risks.push({ code: 'LOOPBACK_HOST', severity: 'critical', message: 'Loopback or local host is not allowed' })
  }
  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname) || hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    risks.push({ code: 'PRIVATE_OR_METADATA_HOST', severity: 'critical', message: 'Private, link-local or cloud metadata host requires blocking review' })
  }
  if (hostname && !isIpv4Literal(hostname) && !isIpv6Literal(hostname) && !isLocalHostname(hostname)) {
    risks.push({ code: 'DNS_REBINDING_RISK', severity: 'high', message: 'Hostname resolution must be pinned and revalidated to prevent DNS rebinding' })
  }
  if (parsed.username || parsed.password) {
    risks.push({ code: 'URL_CREDENTIALS', severity: 'critical', message: 'Credentials embedded in URL must be removed' })
  }
  if (parsed.search) {
    for (const key of parsed.searchParams.keys()) {
      if (/token|secret|password|key|sig|credential|cookie|authorization/i.test(key)) {
        risks.push({ code: 'SENSITIVE_QUERY', severity: 'high', message: 'Sensitive query parameter must become a secret reference' })
      }
    }
  }
  if (config.redirects || config.followRedirects || config.maxRedirects !== undefined || config.allowRedirects || config.redirectPolicy) {
    risks.push({ code: 'REDIRECT_POLICY', severity: 'high', message: 'Redirect behavior needs an explicit allowlist and hop limit' })
  }
  return dedupeRisks(risks)
}

function summarizeAuth(headers: Record<string, unknown>, config: Record<string, unknown>): { present: boolean; type?: string } {
  const headerNames = Object.keys(headers)
  const authHeader = headerNames.find((name) => /^(authorization|proxy-authorization)$/i.test(name))
  const apiKey = headerNames.find((name) => /^(x-api-key|api-key)$/i.test(name))
  const cookie = headerNames.find((name) => /^(cookie|set-cookie)$/i.test(name))
  if (authHeader) {
    const value = headers[authHeader]
    const type = typeof value === 'string' && /^(bearer|basic)\b/i.test(value) ? value.split(/\s+/)[0].toLowerCase() : 'header'
    return { present: true, type }
  }
  if (cookie) return { present: true, type: 'cookie' }
  if (apiKey || Object.keys(config).some((key) => /token|secret|password|credential|api.?key/i.test(key) && config[key] !== undefined)) {
    return { present: true, type: apiKey ? 'api-key' : 'configured-secret' }
  }
  return { present: false }
}

function summarizeShape(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null
  if (depth >= 12) return '[depth-limited]'
  if (Array.isArray(value)) return { kind: 'array', items: value.length > 0 ? summarizeShape(value[0], depth + 1) : 'unknown', truncated: value.length > 128 }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort()
    const selected = keys.slice(0, 128)
    const shape = Object.fromEntries(selected.map((key) => [key, summarizeShape(value[key], depth + 1)]))
    if (keys.length > selected.length) shape.__truncated__ = true
    return shape
  }
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'unknown'
}

function queryKeys(rawUrl: string, query: Record<string, unknown>): string[] {
  const keys = new Set(Object.keys(query))
  try { for (const key of new URL(rawUrl).searchParams.keys()) keys.add(key) } catch { /* URL risk report already contains INVALID_URL. */ }
  return [...keys].sort((a, b) => a.localeCompare(b))
}

function normalizeMethod(value: unknown): string { return typeof value === 'string' && HTTP_METHODS.has(value.toUpperCase()) ? value.toUpperCase() : 'GET' }
function normalizeHostname(hostname: string): string { return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '') }
function isLocalHostname(hostname: string): boolean { return hostname === 'localhost' || hostname === 'localhost.localdomain' || hostname.endsWith('.localhost') }
function isLoopbackHost(hostname: string): boolean { return isLocalHostname(hostname) || isLoopbackIpv4(hostname) || isLoopbackIpv6(hostname) }
function isLoopbackIpv4(hostname: string): boolean { const parts = parseIpv4(hostname); return !!parts && (parts[0] === 127 || parts[0] === 0) }
function isPrivateIpv4(hostname: string): boolean {
  const parts = parseIpv4(hostname)
  if (!parts) return false
  return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 169 && parts[1] === 254
}
function isIpv4Literal(hostname: string): boolean { return !!parseIpv4(hostname) }
function parseIpv4(hostname: string): [number, number, number, number] | undefined {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined
  return parts as [number, number, number, number]
}
function isPrivateIpv6(hostname: string): boolean {
  const parts = parseIpv6(hostname)
  if (!parts) return false
  const first = parts[0]
  if ((first & 0xfe00) === 0xfc00 || (first >= 0xfe80 && first <= 0xfebf)) return true
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    const ipv4: [number, number, number, number] = [parts[6] >>> 8, parts[6] & 0xff, parts[7] >>> 8, parts[7] & 0xff]
    return isPrivateIpv4(ipv4.join('.')) || ipv4[0] === 127 || ipv4[0] === 0
  }
  return false
}
function isLoopbackIpv6(hostname: string): boolean {
  const parts = parseIpv6(hostname)
  return !!parts && parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1
}
function isIpv6Literal(hostname: string): boolean { return !!parseIpv6(hostname) }
function parseIpv6(hostname: string): number[] | undefined {
  const value = normalizeHostname(hostname)
  if (!value.includes(':')) return undefined
  const [withoutZone] = value.split('%')
  const zoneFree = withoutZone
  const lastColon = zoneFree.lastIndexOf(':')
  let source = zoneFree
  if (zoneFree.includes('.') && lastColon >= 0) {
    const ipv4Text = zoneFree.slice(lastColon + 1)
    const ipv4 = parseIpv4(ipv4Text)
    if (!ipv4) return undefined
    source = zoneFree.slice(0, lastColon + 1) + ((ipv4[0] << 8) | ipv4[1]).toString(16) + ':' + ((ipv4[2] << 8) | ipv4[3]).toString(16)
  }
  const halves = source.split('::')
  if (halves.length > 2) return undefined
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0
  if (missing < 0 || halves.length === 1 && left.length !== 8) return undefined
  const values = [...left, ...Array.from({ length: missing }, () => '0'), ...right].map((part) => Number.parseInt(part, 16))
  if (values.length !== 8 || values.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) return undefined
  return values
}
function dedupeRisks(risks: UrlRisk[]): UrlRisk[] { return [...new Map(risks.map((risk) => [risk.code, risk])).values()] }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
