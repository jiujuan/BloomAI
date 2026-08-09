export const MAX_SECURITY_STRING_LENGTH = 4_096
export const MAX_SECURITY_DEPTH = 8
export const MAX_SECURITY_FIELDS = 100
export const MAX_SECURITY_ARRAY_ITEMS = 100

const SECRET_KEY_PATTERN = /(?:authorization|api[_-]?key|access[_-]?key|token|secret|password|passphrase|credential|private[_-]?key|headers?|cookie|prompt|raw[_-]?(?:input|prompt)|client[_-]?secret)/i
const SECRET_ASSIGNMENT_PATTERN = /((?:authorization|api[_-]?key|access[_-]?key|token|secret|password|passphrase|credential|private[_-]?key|cookie)\s*[:=]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)/gi
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

export class SkillSecurityError extends Error {
  readonly code: string

  constructor(message: string, code = 'SECURITY_POLICY_VIOLATION') {
    super(message)
    this.name = 'SkillSecurityError'
    this.code = code
  }
}

export type SecurityPayloadOptions = {
  maxDepth?: number
  maxFields?: number
  maxArrayItems?: number
  maxStringLength?: number
}

export function sanitizeSecurityPayload(value: unknown, options: SecurityPayloadOptions = {}): unknown {
  const seen = new WeakSet<object>()
  return sanitizeValue(value, 0, seen, {
    maxDepth: options.maxDepth ?? MAX_SECURITY_DEPTH,
    maxFields: options.maxFields ?? MAX_SECURITY_FIELDS,
    maxArrayItems: options.maxArrayItems ?? MAX_SECURITY_ARRAY_ITEMS,
    maxStringLength: options.maxStringLength ?? MAX_SECURITY_STRING_LENGTH,
  })
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>, options: Required<SecurityPayloadOptions>): unknown {
  if (depth > options.maxDepth) throw new SkillSecurityError(`Security payload exceeds the maximum depth of ${options.maxDepth}`, 'PAYLOAD_DEPTH_LIMIT')
  if (typeof value === 'string') {
    if (value.length > options.maxStringLength) throw new SkillSecurityError(`Security payload string exceeds the maximum length of ${options.maxStringLength}`, 'PAYLOAD_STRING_LIMIT')
    if (CONTROL_CHARACTER_PATTERN.test(value)) throw new SkillSecurityError('Security payload contains control characters', 'INVALID_INPUT')
    return value.normalize('NFKC').replace(SECRET_ASSIGNMENT_PATTERN, '$1[REDACTED]')
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'undefined') return undefined
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') throw new SkillSecurityError('Security payload must be JSON serializable', 'INVALID_PAYLOAD')
  if (typeof value !== 'object') throw new SkillSecurityError('Security payload must be JSON serializable', 'INVALID_PAYLOAD')
  if (seen.has(value)) throw new SkillSecurityError('Security payload cannot contain circular references', 'INVALID_PAYLOAD')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length > options.maxArrayItems) throw new SkillSecurityError(`Security payload array exceeds ${options.maxArrayItems} items`, 'PAYLOAD_ARRAY_LIMIT')
      return value.map((item) => {
        const sanitized = sanitizeValue(item, depth + 1, seen, options)
        return sanitized === undefined ? null : sanitized
      })
    }
    const entries = Object.entries(value)
    if (entries.length > options.maxFields) throw new SkillSecurityError(`Security payload exceeds ${options.maxFields} fields`, 'PAYLOAD_FIELD_LIMIT')
    const result: Record<string, unknown> = {}
    for (const [key, child] of entries) {
      const normalizedKey = normalizeSecurityString(key)
      const sanitizedChild = SECRET_KEY_PATTERN.test(normalizedKey)
        ? '[REDACTED]'
        : sanitizeValue(child, depth + 1, seen, options)
      if (sanitizedChild !== undefined) result[normalizedKey] = sanitizedChild
    }
    return result
  } finally {
    seen.delete(value)
  }
}

function normalizeSecurityString(value: string): string {
  const normalized = value.normalize('NFKC')
  if (!normalized.trim()) throw new SkillSecurityError('Security payload key must not be empty', 'INVALID_INPUT')
  if (normalized.length > MAX_SECURITY_STRING_LENGTH) throw new SkillSecurityError('Security payload key exceeds the maximum length', 'INPUT_LENGTH_LIMIT')
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) throw new SkillSecurityError('Security payload key contains control characters', 'INVALID_INPUT')
  return normalized
}
