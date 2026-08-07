import type { RedactionOptions, RedactionStats } from './migration.types'

export const REDACTED_VALUE = '[REDACTED]'
const SECRET_KEY_PARTS = new Set([
  'authorization', 'proxyauthorization', 'cookie', 'setcookie', 'xapikey', 'apikey',
  'accesstoken', 'refreshtoken', 'token', 'secret', 'password', 'privatekey',
  'credential', 'credentials', 'clientsecret', 'webhooksecret', 'sessionsecret', 'sig', 'signature',
])
const QUERY_SECRET_KEYS = new Set(['accesstoken', 'refreshtoken', 'token', 'sig', 'signature', 'key', 'credential', 'password', 'secret', 'apikey', 'xapikey'])

export function redactSecrets<T>(value: T, options: RedactionOptions = {}): T {
  return redactWithStats(value, options).value as T
}

export function redactWithStats<T>(value: T, options: RedactionOptions = {}): { value: T; stats: RedactionStats } {
  const knownSecrets = new Set((options.knownSecrets ?? []).filter((secret) => typeof secret === 'string' && secret.length > 0))
  const stats = { redactedCount: 0, keyRedactions: 0, valueRedactions: 0 }

  const visit = (current: unknown, key?: string): unknown => {
    if (typeof current === 'string') {
      if (key && isSecretKey(key)) {
        stats.redactedCount++
        stats.keyRedactions++
        return REDACTED_VALUE
      }
      const redacted = redactSecretText(current, knownSecrets)
      if (redacted !== current) {
        stats.redactedCount++
        stats.valueRedactions++
      }
      return redacted
    }
    if (current === null || typeof current !== 'object') return current
    if (Array.isArray(current)) return current.map((entry) => visit(entry))
    const result: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of Object.entries(current as Record<string, unknown>)) {
      result[entryKey] = visit(entryValue, entryKey)
    }
    return result
  }

  return { value: visit(value) as T, stats }
}

export function redactSecretText(text: string, knownSecrets: ReadonlySet<string> | readonly string[] = []): string {
  const known = knownSecrets instanceof Set ? knownSecrets : new Set(knownSecrets)
  let result = text
  for (const secret of known) result = result.split(secret).join(REDACTED_VALUE)

  result = result
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ' + REDACTED_VALUE)
    .replace(/([?&](?:access[_-]?token|refresh[_-]?token|token|sig(?:nature)?|key|credential|password|secret|api[_-]?key|x-api-key)=)[^&#\s]+/gi, '$1' + REDACTED_VALUE)
    .replace(/\b((?:api[_-]?key|token|secret|password|credential)\s*[:=]\s*)[^,;\s&]+/gi, '$1' + REDACTED_VALUE)

  if (result === text && isLikelyHighEntropySecret(text)) return REDACTED_VALUE
  return result
}

export function isSecretKey(key: string): boolean {
  const normalized = normalizeKey(key)
  if (!normalized) return false
  if (SECRET_KEY_PARTS.has(normalized)) return true
  return [...SECRET_KEY_PARTS].some((part) => normalized.endsWith(part) || normalized.includes(part))
}

export function isLikelyHighEntropySecret(value: string): boolean {
  const candidate = value.trim()
  if (candidate.length < 20 || candidate.length > 4096) return false
  if (/^(https?:\/\/|file:|data:|urn:)/i.test(candidate)) return false
  if (/\s/.test(candidate) || /^(?:[0-9a-f]{8}-[0-9a-f-]{27})$/i.test(candidate)) return false
  if (!/^[A-Za-z0-9+/_=.~-]+$/.test(candidate)) return false
  const alphabet = new Set(candidate).size
  const entropy = shannonEntropy(candidate)
  return entropy >= 3.5 && alphabet >= 10
}

function normalizeKey(key: string): string {
  return key.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]/gu, '')
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>()
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1)
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / value.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}
